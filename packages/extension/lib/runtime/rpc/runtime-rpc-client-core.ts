import { browser } from "@wxt-dev/browser";
import * as RpcClient from "@effect/rpc/RpcClient";
import { RpcClientError } from "@effect/rpc/RpcClientError";
import type * as Rpc from "@effect/rpc/Rpc";
import type * as RpcGroup from "@effect/rpc/RpcGroup";
import type {
  FromClientEncoded,
  FromServerEncoded,
} from "@effect/rpc/RpcMessage";
import {
  makeResettableConnectionLifecycle,
  type ResettableConnectionLifecycle,
} from "@llm-bridge/runtime-core";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

type RuntimeMessageListener = (
  payload: FromServerEncoded,
  ...args: ReadonlyArray<unknown>
) => void;
type RuntimeDisconnectListener = (...args: ReadonlyArray<unknown>) => void;

type RuntimeEventListeners<Listener> = {
  addListener: (listener: Listener) => void;
  removeListener: (listener: Listener) => void;
};

export type RuntimePort = {
  readonly onMessage: RuntimeEventListeners<RuntimeMessageListener>;
  readonly onDisconnect: RuntimeEventListeners<RuntimeDisconnectListener>;
  postMessage: (message: FromClientEncoded) => void;
  disconnect: () => void;
};

type RuntimeConnectOptions = {
  name: string;
};

type RuntimeConnect = (options: RuntimeConnectOptions) => RuntimePort;

type PagehideTarget = {
  addEventListener: (
    type: "pagehide",
    listener: () => void,
    options?: AddEventListenerOptions,
  ) => void;
};

type BeforeReadyHook = (input: {
  connectionId: number;
  port: RuntimePort;
}) => Promise<void>;

type RuntimeClient<Rpcs extends Rpc.Any> = RpcClient.RpcClient<
  Rpcs,
  RpcClientError
>;

export type RuntimeConnection<Rpcs extends Rpc.Any> = {
  connectionId: number;
  scope: Scope.CloseableScope;
  port: RuntimePort;
  client: RuntimeClient<Rpcs>;
  onDisconnect: RuntimeDisconnectListener;
};

export type RuntimeRpcClientCore<Rpcs extends Rpc.Any> = {
  ensureConnection: () => Promise<RuntimeConnection<Rpcs>>;
  destroyConnection: (reason: "destroy" | "pagehide") => Promise<void>;
};

type RuntimeRpcClientCoreOptions<Rpcs extends Rpc.Any, E> = {
  portName: string;
  rpcGroup: RpcGroup.RpcGroup<Rpcs>;
  invalidatedError: () => E;
  connect?: RuntimeConnect;
  windowLike?: PagehideTarget;
  beforeReady?: BeforeReadyHook;
};

const defaultConnect: RuntimeConnect = ({ name }) =>
  browser.runtime.connect({ name });

const defaultWindowLike =
  typeof window === "undefined"
    ? undefined
    : ({
        addEventListener: window.addEventListener.bind(window),
      } satisfies PagehideTarget);

function closeRuntimeConnection<Rpcs extends Rpc.Any>(
  connection: RuntimeConnection<Rpcs>,
): Effect.Effect<void, never> {
  return Effect.tryPromise({
    try: async () => {
      connection.port.onDisconnect.removeListener(connection.onDisconnect);

      await Effect.runPromise(
        Scope.close(connection.scope, Exit.succeed(undefined)),
      ).catch(() => undefined);

      try {
        connection.port.disconnect();
      } catch {
        // ignored
      }
    },
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
}

function createClient<Rpcs extends Rpc.Any>(
  rpcGroup: RpcGroup.RpcGroup<Rpcs>,
  port: RuntimePort,
  scope: Scope.CloseableScope,
): Promise<RuntimeClient<Rpcs>> {
  return Effect.runPromise(
    RpcClient.Protocol.make((writeResponse) =>
      Effect.gen(function* () {
        const onMessage: RuntimeMessageListener = (payload) => {
          void Effect.runPromise(writeResponse(payload)).catch((error) => {
            console.warn(
              "runtime rpc: failed to process server message",
              error,
            );
          });
        };

        port.onMessage.addListener(onMessage);

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            port.onMessage.removeListener(onMessage);
          }),
        );

        return {
          send: (message: FromClientEncoded) =>
            Effect.try({
              try: () => {
                port.postMessage(message);
              },
              catch: (cause) =>
                new RpcClientError({
                  reason: "Protocol",
                  message: "Failed to post runtime RPC message",
                  cause,
                }),
            }),
          supportsAck: true,
          supportsTransferables: false,
        } as const;
      }),
    ).pipe(
      Scope.extend(scope),
      Effect.flatMap((protocol) =>
        RpcClient.make(rpcGroup, {
          disableTracing: true,
        }).pipe(
          Effect.provideService(RpcClient.Protocol, protocol),
          Scope.extend(scope),
        ),
      ),
    ),
  );
}

function createRuntimeConnection<Rpcs extends Rpc.Any, E>(
  options: RuntimeRpcClientCoreOptions<Rpcs, E>,
  destroyIfCurrent: (token: number) => Promise<void>,
  connectionId: number,
): Effect.Effect<RuntimeConnection<Rpcs>, unknown> {
  const connect = options.connect ?? defaultConnect;
  const beforeReady = options.beforeReady ?? (() => Promise.resolve());

  return Effect.tryPromise({
    try: async () => {
      let scope: Scope.CloseableScope | null = null;
      let port: RuntimePort | null = null;
      let onDisconnect: RuntimeDisconnectListener | null = null;

      try {
        const runtimeScope = await Effect.runPromise(Scope.make());
        scope = runtimeScope;

        const runtimePort = connect({
          name: options.portName,
        });
        port = runtimePort;

        onDisconnect = () => {
          void destroyIfCurrent(connectionId).catch(() => undefined);
        };

        runtimePort.onDisconnect.addListener(onDisconnect);

        await beforeReady({
          connectionId,
          port: runtimePort,
        });

        const client = await createClient(
          options.rpcGroup,
          runtimePort,
          runtimeScope,
        );

        return {
          connectionId,
          scope: runtimeScope,
          port: runtimePort,
          client,
          onDisconnect,
        };
      } catch (error) {
        if (port && onDisconnect) {
          port.onDisconnect.removeListener(onDisconnect);
        }

        if (scope) {
          await Effect.runPromise(
            Scope.close(scope, Exit.succeed(undefined)),
          ).catch(() => undefined);
        }

        if (port) {
          try {
            port.disconnect();
          } catch {
            // ignored
          }
        }

        throw error;
      }
    },
    catch: (error) => error,
  });
}

export function makeRuntimeRpcClientCore<Rpcs extends Rpc.Any, E>(
  options: RuntimeRpcClientCoreOptions<Rpcs, E>,
): RuntimeRpcClientCore<Rpcs> {
  let lifecycle: ResettableConnectionLifecycle<
    RuntimeConnection<Rpcs>,
    unknown,
    "disconnect"
  > | null = null;

  const destroyIfCurrent = (token: number) => {
    const current = lifecycle;
    if (!current) return Promise.resolve();
    return Effect.runPromise(
      current.destroyIfCurrent(token, "disconnect"),
    ).catch(() => undefined);
  };

  lifecycle = Effect.runSync(
    makeResettableConnectionLifecycle<
      RuntimeConnection<Rpcs>,
      unknown,
      "disconnect"
    >({
      create: (token) =>
        createRuntimeConnection(options, destroyIfCurrent, token),
      close: (connection) => closeRuntimeConnection(connection),
      invalidatedError: options.invalidatedError,
    }),
  );

  const destroyConnection = async (_reason: "destroy" | "pagehide") => {
    if (!lifecycle) return;
    await Effect.runPromise(lifecycle.destroy).catch(() => undefined);
  };

  const windowLike = options.windowLike ?? defaultWindowLike;
  windowLike?.addEventListener(
    "pagehide",
    () => {
      void destroyConnection("pagehide");
    },
    { once: true },
  );

  return {
    ensureConnection: () => Effect.runPromise(lifecycle.ensure),
    destroyConnection,
  };
}
