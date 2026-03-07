import {
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_READY_EVENT,
  PageBridgeRpcGroup,
  RuntimeValidationError,
  isPageBridgePortControlMessage,
  serializeUnknownRuntimeError,
  type BridgeModelCallRequest,
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
import * as Stream from "effect/Stream";
import { getRuntimePublicRPC } from "@/lib/runtime/rpc/runtime-public-rpc-client";

function nextBridgeRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeModelCallInput(input: BridgeModelCallRequest) {
  const requestId = input.requestId ?? nextBridgeRequestId();
  const sessionID = input.sessionID ?? requestId;

  return {
    requestId,
    sessionID,
    modelId: input.modelId,
    options: input.options,
  };
}

function mapRuntimeEffect<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.mapError(effect, serializeUnknownRuntimeError);
}

function mapRuntimeStream<A, E, R>(stream: Stream.Stream<A, E, R>) {
  return Stream.mapError(stream, serializeUnknownRuntimeError);
}

function createPageBridgeHandlers() {
  const runtime = getRuntimePublicRPC();

  return PageBridgeRpcGroup.of({
    listModels: () =>
      mapRuntimeEffect(
        runtime.listModels({
          origin: window.location.origin,
          connectedOnly: true,
        }),
      ).pipe(
        Effect.map((models) => ({
          models,
        })),
      ),

    getModel: (input) =>
      mapRuntimeEffect(
        Effect.gen(function* () {
          const requestId = input.requestId ?? nextBridgeRequestId();
          const sessionID = input.sessionID ?? requestId;

          return yield* runtime.acquireModel({
            origin: window.location.origin,
            requestId,
            sessionID,
            modelId: input.modelId,
          });
        }),
      ),

    requestPermission: (input) =>
      mapRuntimeEffect(
        Effect.gen(function* () {
          const result = yield* runtime.requestPermission({
            action: "create",
            origin: window.location.origin,
            modelId: input.modelId,
          });

          if (!("status" in result)) {
            return yield* new RuntimeValidationError({
              message: "Unexpected permission response shape",
            });
          }

          return result;
        }),
      ),

    abort: (input) =>
      mapRuntimeEffect(
        Effect.gen(function* () {
          if (!input.requestId) {
            return { ok: true };
          }

          const sessionID = input.sessionID ?? input.requestId;

          yield* runtime.abortModelCall({
            origin: window.location.origin,
            sessionID,
            requestId: input.requestId,
          });

          return {
            ok: true,
          };
        }),
      ),

    modelDoGenerate: (input) =>
      mapRuntimeEffect(
        Effect.gen(function* () {
          const normalized = normalizeModelCallInput(input);
          if (!normalized.options) {
            return yield* new RuntimeValidationError({
              message: "modelDoGenerate requires call options with prompt",
            });
          }
          return yield* runtime.modelDoGenerate({
            origin: window.location.origin,
            requestId: normalized.requestId,
            sessionID: normalized.sessionID,
            modelId: normalized.modelId,
            options: normalized.options,
          });
        }),
      ),

    modelDoStream: (input) => {
      const normalized = normalizeModelCallInput(input);
      const options = normalized.options;
      if (!options) {
        return Stream.fail(
          new RuntimeValidationError({
            message: "modelDoStream requires call options with prompt",
          }),
        );
      }

      return mapRuntimeStream(
        runtime.modelDoStream({
          origin: window.location.origin,
          requestId: normalized.requestId,
          sessionID: normalized.sessionID,
          modelId: normalized.modelId,
          options,
        }),
      );
    },
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
