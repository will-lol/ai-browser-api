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

type BeforeReadyHook<E> = (input: {
  connectionId: number;
  port: RuntimePort;
}) => Effect.Effect<void, E>;

type RuntimeClient<Rpcs extends Rpc.Any> = RpcClient.RpcClient<
  Rpcs,
  RpcClientError
>;
export type RuntimeRpcClientConnection<Rpcs extends Rpc.Any> = RuntimeClient<Rpcs>;

export type RuntimeConnection<Rpcs extends Rpc.Any> = {
  connectionId: number;
  scope: Scope.CloseableScope;
  port: RuntimePort;
  client: RuntimeClient<Rpcs>;
  onDisconnect: RuntimeDisconnectListener;
};

export type RuntimeRpcClientCore<Rpcs extends Rpc.Any, E> = {
  ensureConnection: Effect.Effect<RuntimeConnection<Rpcs>, E>;
  ensureClient: Effect.Effect<RuntimeClient<Rpcs>, E>;
  destroyConnection: (
    reason: "destroy" | "pagehide",
  ) => Effect.Effect<void, never>;
};

type RuntimeRpcClientCoreOptions<Rpcs extends Rpc.Any, E> = {
  portName: string;
  rpcGroup: RpcGroup.RpcGroup<Rpcs>;
  invalidatedError: () => E;
  connect?: RuntimeConnect;
  windowLike?: PagehideTarget;
  beforeReady?: BeforeReadyHook<E>;
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
  return Effect.gen(function* () {
    connection.port.onDisconnect.removeListener(connection.onDisconnect);

    yield* Scope.close(connection.scope, Exit.succeed(undefined)).pipe(
      Effect.catchAll(() => Effect.void),
    );

    try {
      connection.port.disconnect();
    } catch {
      // ignored
    }
  }).pipe(Effect.catchAll(() => Effect.void));
}

function createClient<Rpcs extends Rpc.Any>(
  rpcGroup: RpcGroup.RpcGroup<Rpcs>,
  port: RuntimePort,
): Effect.Effect<RuntimeClient<Rpcs>, never, Scope.Scope> {
  return RpcClient.Protocol.make((writeResponse) =>
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
    Effect.flatMap((protocol) =>
      RpcClient.make(rpcGroup, {
        disableTracing: true,
      }).pipe(Effect.provideService(RpcClient.Protocol, protocol)),
    ),
  );
}

function createRuntimeConnection<Rpcs extends Rpc.Any, E>(
  options: RuntimeRpcClientCoreOptions<Rpcs, E>,
  destroyIfCurrent: (token: number) => Promise<void>,
  connectionId: number,
): Effect.Effect<RuntimeConnection<Rpcs>, E> {
  const connect = options.connect ?? defaultConnect;
  const beforeReady = options.beforeReady ?? (() => Effect.void);

  return Effect.gen(function* () {
    const runtimeScope = yield* Scope.make();

    return yield* Effect.gen(function* () {
      const runtimePort = connect({
        name: options.portName,
      });

      const onDisconnect = () => {
        void destroyIfCurrent(connectionId).catch(() => undefined);
      };

      runtimePort.onDisconnect.addListener(onDisconnect);

      yield* Scope.addFinalizer(
        runtimeScope,
        Effect.sync(() => {
          runtimePort.onDisconnect.removeListener(onDisconnect);
          try {
            runtimePort.disconnect();
          } catch {
            // ignored
          }
        }),
      );

      yield* beforeReady({
        connectionId,
        port: runtimePort,
      });

      const client = yield* createClient(options.rpcGroup, runtimePort).pipe(
        Scope.extend(runtimeScope),
      );

      return {
        connectionId,
        scope: runtimeScope,
        port: runtimePort,
        client,
        onDisconnect,
      };
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Scope.close(runtimeScope, exit) : Effect.void,
      ),
    );
  });
}

export function makeRuntimeRpcClientCore<Rpcs extends Rpc.Any, E>(
  options: RuntimeRpcClientCoreOptions<Rpcs, E>,
): RuntimeRpcClientCore<Rpcs, E> {
  let lifecycle: ResettableConnectionLifecycle<
    RuntimeConnection<Rpcs>,
    E,
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
      E,
      "disconnect"
    >({
      create: (token) =>
        createRuntimeConnection(options, destroyIfCurrent, token),
      close: (connection) => closeRuntimeConnection(connection),
      invalidatedError: options.invalidatedError,
    }),
  );

  const destroyConnection = (_reason: "destroy" | "pagehide") =>
    lifecycle
      ? lifecycle.destroy.pipe(Effect.catchAll(() => Effect.void))
      : Effect.void;

  const windowLike = options.windowLike ?? defaultWindowLike;
  windowLike?.addEventListener(
    "pagehide",
    () => {
      void Effect.runPromise(destroyConnection("pagehide"));
    },
    { once: true },
  );

  return {
    ensureConnection: lifecycle.ensure,
    ensureClient: lifecycle.ensure.pipe(Effect.map((connection) => connection.client)),
    destroyConnection,
  };
}
