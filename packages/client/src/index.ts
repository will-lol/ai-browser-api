import {
  fromRuntimeGenerateResponse,
  fromRuntimeStreamPart,
  toRuntimeModelCallOptions,
} from "@llm-bridge/bridge-codecs";
import {
  PAGE_BRIDGE_INIT_MESSAGE,
  PAGE_BRIDGE_PORT_CONTROL_MESSAGE,
  PAGE_BRIDGE_READY_EVENT,
  PageBridgeRpcGroup,
  RuntimeValidationError,
  decodeSupportedUrls,
  toRuntimeRpcError,
  type BridgePermissionRequest,
  type BridgeModelDescriptorResponse,
  type PageBridgeRpc,
  type RuntimeCreatePermissionRequestResponse,
  type RuntimeModelSummary,
  type RuntimeRpcError,
  type PageBridgePortControlMessage,
} from "@llm-bridge/contracts";
import { makeResettableConnectionLifecycle } from "@llm-bridge/runtime-core";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import * as RpcClient from "@effect/rpc/RpcClient";
import { RpcClientError } from "@effect/rpc/RpcClientError";
import type { FromClientEncoded, FromServerEncoded } from "@effect/rpc/RpcMessage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

const DEFAULT_TIMEOUT_MS = 30_000;
const CONNECTION_INVALIDATED_MESSAGE =
  "Bridge connection was destroyed while connecting";

type PageBridgeClient = Effect.Effect.Success<
  ReturnType<typeof RpcClient.make<PageBridgeRpc>>
>;

type BridgeConnection = {
  connectionId: number;
  scope: Scope.CloseableScope;
  port: MessagePort;
  client: PageBridgeClient;
};

export type BridgeClientOptions = {
  timeoutMs?: number;
};

export type BridgeModelSummary = RuntimeModelSummary;
export type BridgePermissionResult = RuntimeCreatePermissionRequestResponse;

export interface BridgeClientApi {
  readonly listModels: Effect.Effect<
    ReadonlyArray<BridgeModelSummary>,
    RuntimeRpcError
  >;
  getModel: (
    modelId: string,
  ) => Effect.Effect<LanguageModelV3, RuntimeRpcError>;
  requestPermission: (
    payload: BridgePermissionRequest,
  ) => Effect.Effect<BridgePermissionResult, RuntimeRpcError>;
  readonly destroy: Effect.Effect<void, never>;
}

export class BridgeClient extends Context.Tag(
  "@llm-bridge/client/BridgeClient",
)<BridgeClient, BridgeClientApi>() {}

function createAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function waitForBridgeReady(timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }

    if (document.documentElement.dataset.llmBridgeReady === "true") {
      resolve();
      return;
    }

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Bridge initialization timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener(PAGE_BRIDGE_READY_EVENT, onReady);
    };

    window.addEventListener(PAGE_BRIDGE_READY_EVENT, onReady, { once: true });
  });
}

type CloseConnectionReason = "destroy" | "stale";

function closeConnection(
  connection: BridgeConnection,
  options: {
    reason: CloseConnectionReason;
  },
): Effect.Effect<void, never> {
  const { reason } = options;
  const disconnectReason =
    reason === "destroy" ? "client-destroy" : "stale-connection";

  return Effect.tryPromise({
    try: async () => {
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

      try {
        await Effect.runPromise(
          Scope.close(connection.scope, Exit.succeed(undefined)),
        );
      } catch {
        // ignored
      }

      try {
        connection.port.close();
      } catch {
        // ignored
      }

    },
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
}

function createConnection(
  connectionId: number,
  options: BridgeClientOptions,
): Effect.Effect<BridgeConnection, RuntimeRpcError> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return Effect.tryPromise({
    try: async () => {
      let scope: Scope.CloseableScope | null = null;
      let port: MessagePort | null = null;

      try {
        await waitForBridgeReady(timeoutMs);

        const runtimeScope = await Effect.runPromise(Scope.make());
        scope = runtimeScope;

        const messageChannel = new MessageChannel();
        const runtimePort = messageChannel.port1;
        port = runtimePort;

        const protocol = await Effect.runPromise(
          RpcClient.Protocol.make((writeResponse) =>
            Effect.gen(function* () {
              const onMessage = (event: MessageEvent<FromServerEncoded>) => {
                void Effect.runPromise(writeResponse(event.data)).catch(
                  () => undefined,
                );
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
          ).pipe(Scope.extend(runtimeScope)),
        );

        const client = await Effect.runPromise(
          RpcClient.make(PageBridgeRpcGroup, {
            disableTracing: true,
          }).pipe(
            Effect.provideService(RpcClient.Protocol, protocol),
            Scope.extend(runtimeScope),
          ),
        );

        window.postMessage({ type: PAGE_BRIDGE_INIT_MESSAGE }, "*", [
          messageChannel.port2,
        ]);

        return {
          connectionId,
          scope: runtimeScope,
          port: runtimePort,
          client,
        };
      } catch (error) {
        if (scope) {
          try {
            await Effect.runPromise(
              Scope.close(scope, Exit.succeed(undefined)),
            );
          } catch {
            // ignored
          }
        }

        if (port) {
          try {
            port.close();
          } catch {
            // ignored
          }
        }

        throw error;
      }
    },
    catch: toRuntimeRpcError,
  });
}

function nextRequestId(sequence: number) {
  return `req_${Date.now()}_${sequence}`;
}

export function BridgeClientLive(options: BridgeClientOptions = {}) {
  return Layer.scoped(
    BridgeClient,
    Effect.gen(function* () {
      let sequence = 0;
      const lifecycle = yield* makeResettableConnectionLifecycle<
        BridgeConnection,
        RuntimeRpcError
      >({
        create: (connectionId) => createConnection(connectionId, options),
        close: (connection, reason) =>
          closeConnection(connection, {
            reason,
          }),
        invalidatedError: () =>
          new RuntimeValidationError({
            message: CONNECTION_INVALIDATED_MESSAGE,
          }),
      });

      const ensureConnection = lifecycle.ensure;

      const normalizeRpcError = <A, R>(
        effect: Effect.Effect<A, RuntimeRpcError | RpcClientError, R>,
      ): Effect.Effect<A, RuntimeRpcError, R> =>
        Effect.mapError(effect, toRuntimeRpcError);

      const normalizeRpcStreamError = <A, R>(
        stream: Stream.Stream<A, RuntimeRpcError | RpcClientError, R>,
      ): Stream.Stream<A, RuntimeRpcError, R> =>
        Stream.mapError(stream, toRuntimeRpcError);

      const abortRequest = (input: { requestId: string; sessionID: string }) =>
        ensureConnection.pipe(
          Effect.flatMap((current) =>
            normalizeRpcError(
              current.client.abort({
                requestId: input.requestId,
                sessionID: input.sessionID,
              }),
            ),
          ),
          Effect.asVoid,
        );

      const destroy = lifecycle.destroy.pipe(
        Effect.catchAll(() => Effect.void),
      );

      yield* Effect.addFinalizer(() => destroy);

      const createLanguageModel = (
        modelId: string,
        descriptor: BridgeModelDescriptorResponse,
      ): LanguageModelV3 => ({
        specificationVersion: descriptor.specificationVersion,
        provider: descriptor.provider,
        modelId: descriptor.modelId,
        supportedUrls: decodeSupportedUrls(descriptor.supportedUrls),
        async doGenerate(options) {
          sequence += 1;
          const requestId = nextRequestId(sequence);
          const abortSignal = options.abortSignal;

          if (abortSignal?.aborted) {
            throw createAbortError();
          }

          const onAbort = () => {
            void Effect.runPromise(
              abortRequest({
                requestId,
                sessionID: requestId,
              }),
            ).catch(
              () => undefined,
            );
          };

          abortSignal?.addEventListener("abort", onAbort, { once: true });

          try {
            const current = await Effect.runPromise(ensureConnection);
            const response = await Effect.runPromise(
              normalizeRpcError(
                current.client.modelDoGenerate({
                  requestId,
                  sessionID: requestId,
                  modelId,
                  options: toRuntimeModelCallOptions(options),
                }),
              ),
            );

            return fromRuntimeGenerateResponse(response);
          } finally {
            abortSignal?.removeEventListener("abort", onAbort);
          }
        },
        async doStream(options) {
          sequence += 1;
          const requestId = nextRequestId(sequence);
          const abortSignal = options.abortSignal;

          if (abortSignal?.aborted) {
            throw createAbortError();
          }

          const current = await Effect.runPromise(ensureConnection);
          const runtimeStream = await Effect.runPromise(
            Effect.scoped(
              Stream.toReadableStreamEffect(
                normalizeRpcStreamError(
                  current.client.modelDoStream({
                    requestId,
                    sessionID: requestId,
                    modelId,
                    options: toRuntimeModelCallOptions(options),
                  }),
                ),
              ),
            ),
          );

          const reader = runtimeStream.getReader();
          const onAbort = () => {
            void Effect.runPromise(
              abortRequest({
                requestId,
                sessionID: requestId,
              }),
            ).catch(
              () => undefined,
            );
          };

          abortSignal?.addEventListener("abort", onAbort, { once: true });

          const cleanup = () => {
            abortSignal?.removeEventListener("abort", onAbort);
          };

          return {
            stream: new ReadableStream<LanguageModelV3StreamPart>({
              async pull(controller) {
                const next = await reader.read();
                if (next.done) {
                  cleanup();
                  controller.close();
                  return;
                }
                controller.enqueue(fromRuntimeStreamPart(next.value));
              },
              async cancel() {
                try {
                  await reader.cancel();
                } finally {
                  cleanup();
                  void Effect.runPromise(
                    abortRequest({
                      requestId,
                      sessionID: requestId,
                    }),
                  ).catch(() => undefined);
                }
              },
            }),
          };
        },
      });

      const listModels = ensureConnection.pipe(
        Effect.flatMap((current) =>
          normalizeRpcError(current.client.listModels({})),
        ),
        Effect.map((response) => response.models),
      );

      const requestPermission = (payload: BridgePermissionRequest) =>
        ensureConnection.pipe(
          Effect.flatMap((current) =>
            normalizeRpcError(current.client.requestPermission(payload)),
          ),
        );

      const getModel = (modelId: string) =>
        Effect.gen(function* () {
          sequence += 1;
          const requestId = nextRequestId(sequence);
          const current = yield* ensureConnection;
          const descriptor = yield* normalizeRpcError(
            current.client.getModel({
              modelId,
              requestId,
              sessionID: requestId,
            }),
          );

          return createLanguageModel(modelId, descriptor);
        });

      return {
        listModels,
        getModel,
        requestPermission,
        destroy,
      } satisfies BridgeClientApi;
    }),
  );
}

export function withBridgeClient<R, E, A>(
  effect: Effect.Effect<A, E, R | BridgeClient>,
  options: BridgeClientOptions = {},
): Effect.Effect<A, E, Exclude<R, BridgeClient>> {
  return effect.pipe(Effect.provide(BridgeClientLive(options)));
}
