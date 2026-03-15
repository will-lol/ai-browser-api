import {
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_PORT_CONTROL_MESSAGE,
  PAGE_BRIDGE_READY_EVENT,
  PageBridgeRpcGroup,
  BridgeInitializationTimeoutError,
  RuntimeDefectError,
  type PageBridgePortControlMessage,
  type PageBridgeRpc,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import { RpcClientError } from "@effect/rpc/RpcClientError";
import type {
  FromClientEncoded,
  FromServerEncoded,
} from "@effect/rpc/RpcMessage";
import * as RpcClient from "@effect/rpc/RpcClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import {
  DEFAULT_TIMEOUT_MS,
  requireBrowserWindow,
  type BrowserWindowLike,
} from "./shared";
import { runDetachedClientTransport } from "./transport-boundary";
import type { BridgeClientOptions } from "./types";

export type PageBridgeClient = Effect.Effect.Success<
  ReturnType<typeof RpcClient.make<PageBridgeRpc>>
>;

export type BridgeConnection = {
  connectionId: number;
  scope: Scope.CloseableScope;
  port: MessagePort;
  client: PageBridgeClient;
};

type CloseConnectionReason = "destroy" | "stale";

function waitForBridgeReady(
  currentWindow: BrowserWindowLike,
  timeoutMs: number,
) {
  return Effect.async<void, BridgeInitializationTimeoutError>((resume) => {
    if (document.documentElement.dataset.llmBridgeReady === "true") {
      resume(Effect.void);
      return;
    }

    const timer = currentWindow.setTimeout(() => {
      cleanup();
      resume(
        Effect.fail(
          new BridgeInitializationTimeoutError({
            timeoutMs,
            message: `Bridge initialization timed out after ${timeoutMs}ms`,
          }),
        ),
      );
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resume(Effect.void);
    };

    const cleanup = () => {
      currentWindow.clearTimeout(timer);
      currentWindow.removeEventListener(PAGE_BRIDGE_READY_EVENT, onReady);
    };

    currentWindow.addEventListener(PAGE_BRIDGE_READY_EVENT, onReady, {
      once: true,
    });
  });
}

export function closeConnection(
  connection: BridgeConnection,
  options: {
    reason: CloseConnectionReason;
  },
): Effect.Effect<void, never> {
  const { reason } = options;
  const disconnectReason =
    reason === "destroy" ? "client-destroy" : "stale-connection";

  return Effect.gen(function* () {
      const disconnectMessage: PageBridgePortControlMessage = {
        _tag: PAGE_BRIDGE_PORT_CONTROL_MESSAGE,
        type: "disconnect",
        reason: disconnectReason,
        connectionId: connection.connectionId,
      };

      try {
        connection.port.postMessage(disconnectMessage);
      } catch {
        // ignored
      }

      yield* Scope.close(connection.scope, Exit.succeed(undefined)).pipe(
        Effect.catchAll(() => Effect.void),
      );

      try {
        connection.port.close();
      } catch {
        // ignored
      }
  }).pipe(Effect.catchAll(() => Effect.void));
}

export function createConnection(
  connectionId: number,
  options: BridgeClientOptions,
): Effect.Effect<BridgeConnection, RuntimeRpcError> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return Effect.gen(function* () {
    const currentWindow = yield* Effect.try({
      try: () => requireBrowserWindow(),
      catch: (error) => error as RuntimeRpcError,
    });
    yield* waitForBridgeReady(currentWindow, timeoutMs);

    const runtimeScope = yield* Scope.make();

    return yield* Effect.gen(function* () {
      const messageChannel = new MessageChannel();
      const runtimePort = messageChannel.port1;

      yield* Scope.addFinalizer(
        runtimeScope,
        Effect.sync(() => {
          try {
            runtimePort.close();
          } catch {
            // ignored
          }
        }),
      );

      const protocol = yield* RpcClient.Protocol.make((writeResponse) =>
        Effect.gen(function* () {
          const onMessage = (event: MessageEvent<FromServerEncoded>) => {
            runDetachedClientTransport(writeResponse(event.data), {
              onError: () => undefined,
            });
          };

          runtimePort.addEventListener("message", onMessage);
          runtimePort.start();

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              runtimePort.removeEventListener("message", onMessage);
            }),
          );

          return {
            send: (message: FromClientEncoded) =>
              Effect.try({
                try: () => {
                  runtimePort.postMessage(message);
                },
                catch: (cause) =>
                  new RpcClientError({
                    reason: "Protocol",
                    message: "Failed to post page bridge RPC message",
                    cause,
                  }),
              }),
            supportsAck: true,
            supportsTransferables: false,
          } as const;
        }),
      ).pipe(Scope.extend(runtimeScope));

      const client = yield* RpcClient.make(PageBridgeRpcGroup, {
        disableTracing: true,
      }).pipe(
        Effect.provideService(RpcClient.Protocol, protocol),
        Scope.extend(runtimeScope),
      );

      currentWindow.postMessage({ type: PAGE_BRIDGE_INIT_MESSAGE }, "*", [
        messageChannel.port2,
      ]);

      return {
        connectionId,
        scope: runtimeScope,
        port: runtimePort,
        client,
      };
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? Scope.close(runtimeScope, exit) : Effect.void,
      ),
    );
  }).pipe(
    Effect.catchAllDefect((defect) =>
      Effect.fail(
        new RuntimeDefectError({
          defect: String(defect),
        }),
      ),
    ),
  );
}
