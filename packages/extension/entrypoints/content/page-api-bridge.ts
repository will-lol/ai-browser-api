import {
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_READY_EVENT,
  PageBridgeRpcGroup,
  RuntimeAuthorizationError,
  RuntimeDefectError,
  isPageBridgePortControlMessage,
  type PageBridgePortControlMessage,
} from "@llm-bridge/contracts";
import * as RpcServer from "@effect/rpc/RpcServer";
import type {
  FromClientEncoded,
  FromServerEncoded,
} from "@effect/rpc/RpcMessage";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Mailbox from "effect/Mailbox";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import { getRuntimePublicRPC } from "@/lib/runtime/rpc/runtime-public-rpc-client";

function unauthorized(operation: string) {
  return Effect.fail(
    new RuntimeAuthorizationError({
      operation,
      message: `${operation} is not available from page bridge clients`,
    }),
  );
}

function mapRuntimeEffect<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.catchAllDefect(effect, (defect) =>
    Effect.fail(new RuntimeDefectError({ defect: String(defect) })),
  );
}

function createPageBridgeHandlers() {
  const runtime = getRuntimePublicRPC();

  return PageBridgeRpcGroup.of({
    listModels: ({ connectedOnly, providerID }) =>
      mapRuntimeEffect(
        runtime.listModels({
          origin: window.location.origin,
          connectedOnly,
          providerID,
        }),
      ),

    getOriginState: (_input) =>
      mapRuntimeEffect(
        runtime.getOriginState({
          origin: window.location.origin,
        }),
      ),

    listPending: (_input) =>
      mapRuntimeEffect(
        runtime.listPending({
          origin: window.location.origin,
        }),
      ),

    acquireModel: (input) =>
      mapRuntimeEffect(
        runtime.acquireModel({
          ...input,
          origin: window.location.origin,
        }),
      ),

    createPermissionRequest: (input) =>
      mapRuntimeEffect(
        runtime.createPermissionRequest({
          ...input,
          origin: window.location.origin,
        }),
      ),

    abortModelCall: (input) =>
      mapRuntimeEffect(
        Effect.gen(function* () {
          yield* runtime.abortModelCall({
            ...input,
            origin: window.location.origin,
          });
        }),
      ),

    modelDoGenerate: (input) =>
      mapRuntimeEffect(
        runtime.modelDoGenerate({
          ...input,
          origin: window.location.origin,
        }),
      ),

    modelDoStream: (input) =>
      runtime.modelDoStream({
        ...input,
        origin: window.location.origin,
      }),

    chatSendMessages: (input) =>
      runtime.chatSendMessages({
        ...input,
        origin: window.location.origin,
      }),

    chatReconnectStream: (input) =>
      runtime.chatReconnectStream({
        ...input,
        origin: window.location.origin,
      }),

    abortChatStream: (input) =>
      mapRuntimeEffect(
        Effect.gen(function* () {
          yield* runtime.abortChatStream({
            ...input,
            origin: window.location.origin,
          });
        }),
      ),

    listProviders: () => unauthorized("listProviders"),
    listConnectedModels: () => unauthorized("listConnectedModels"),
    listPermissions: () => unauthorized("listPermissions"),
    openProviderAuthWindow: () => unauthorized("openProviderAuthWindow"),
    getProviderAuthFlow: () => unauthorized("getProviderAuthFlow"),
    startProviderAuthFlow: () => unauthorized("startProviderAuthFlow"),
    cancelProviderAuthFlow: () => unauthorized("cancelProviderAuthFlow"),
    disconnectProvider: () => unauthorized("disconnectProvider"),
    setOriginEnabled: () => unauthorized("setOriginEnabled"),
    setModelPermission: () => unauthorized("setModelPermission"),
    resolvePermissionRequest: () => unauthorized("resolvePermissionRequest"),
    dismissPermissionRequest: () => unauthorized("dismissPermissionRequest"),
  });
}

type PageBridgeSession = {
  readonly id: number;
  readonly port: MessagePort;
  readonly cleanup: (reason: string) => Promise<void>;
};

async function attachServerToPort(
  sessionId: number,
  port: MessagePort,
  sessions: Map<MessagePort, PageBridgeSession>,
) {
  const scope = await Effect.runPromise(Scope.make());
  let disposed = false;
  let onMessage:
    | ((
        event: MessageEvent<FromClientEncoded | PageBridgePortControlMessage>,
      ) => void)
    | null = null;
  let onMessageError: ((event: MessageEvent<unknown>) => void) | null = null;

  const cleanup = async (_reason: string) => {
    if (disposed) return;
    disposed = true;

    if (onMessage) {
      port.removeEventListener("message", onMessage);
    }

    if (onMessageError) {
      port.removeEventListener("messageerror", onMessageError);
    }

    const existing = sessions.get(port);
    if (existing?.id === sessionId) {
      sessions.delete(port);
    }

    await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined))).catch(
      () => undefined,
    );

    try {
      port.close();
    } catch {
      // ignored
    }
  };

  const handlersLayer = PageBridgeRpcGroup.toLayer(
    Effect.succeed(createPageBridgeHandlers()),
  );

  const protocol = await Effect.runPromise(
    RpcServer.Protocol.make((writeRequest) =>
      Effect.gen(function* () {
        const disconnects = yield* Mailbox.make<number>();
        const clientIds = new Set<number>([0]);

        onMessage = (
          event: MessageEvent<FromClientEncoded | PageBridgePortControlMessage>,
        ) => {
          if (isPageBridgePortControlMessage(event.data)) {
            if (event.data.type === "disconnect") {
              void cleanup("control-disconnect");
            }

            return;
          }

          void Effect.runPromise(writeRequest(0, event.data)).catch((error) => {
            console.warn("page bridge rpc write failed", error);
          });
        };

        onMessageError = (_event: MessageEvent<unknown>) => {
          void Effect.runPromise(disconnects.offer(0)).catch(() => undefined);
          void cleanup("messageerror");
        };

        port.addEventListener("message", onMessage);
        port.addEventListener("messageerror", onMessageError);
        port.start();

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (onMessage) {
              port.removeEventListener("message", onMessage);
            }

            if (onMessageError) {
              port.removeEventListener("messageerror", onMessageError);
            }
          }),
        );

        return {
          disconnects,
          send: (_clientId: number, message: FromServerEncoded) =>
            Effect.sync(() => {
              try {
                port.postMessage(message);
              } catch (_error) {
                void cleanup("postMessage-failed");
              }
            }),
          end: (_clientId: number) => Effect.void,
          clientIds: Effect.sync(() => new Set(clientIds)),
          initialMessage: Effect.succeed(Option.none()),
          supportsAck: true,
          supportsTransferables: false,
          supportsSpanPropagation: true,
        } as const;
      }),
    ).pipe(Scope.extend(scope)),
  );

  await Effect.runPromise(
    RpcServer.make(PageBridgeRpcGroup, {
      disableTracing: true,
      concurrency: "unbounded",
    }).pipe(
      Effect.provide(handlersLayer),
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.forkScoped,
      Scope.extend(scope),
    ),
  );

  return cleanup;
}

export function setupPageApiBridge() {
  const sessions = new Map<MessagePort, PageBridgeSession>();
  let nextSessionId = 0;

  const cleanupAllSessions = async (reason: string) => {
    const activeSessions = [...sessions.values()];

    await Promise.all(activeSessions.map((session) => session.cleanup(reason)));
  };

  const onMessage = async (event: MessageEvent) => {
    // `event.source` is only used as a local filter; authorization is enforced in background RPC.
    if (
      event.source !== window ||
      event.data?.type !== PAGE_BRIDGE_INIT_MESSAGE ||
      !event.ports[0]
    ) {
      return;
    }

    const port = event.ports[0];
    if (sessions.has(port)) {
      return;
    }

    const sessionId = ++nextSessionId;

    try {
      const cleanup = await attachServerToPort(sessionId, port, sessions);
      sessions.set(port, {
        id: sessionId,
        port,
        cleanup,
      });
    } catch (error) {
      console.warn("failed to initialize page bridge rpc", error);
    }
  };

  window.addEventListener("message", onMessage);
  window.addEventListener(
    "pagehide",
    () => {
      void cleanupAllSessions("pagehide");
    },
    { once: true },
  );

  document.documentElement.dataset.llmBridgeReady = "true";
  window.dispatchEvent(new CustomEvent(PAGE_BRIDGE_READY_EVENT));
}
