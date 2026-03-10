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
  BridgeInitializationTimeoutError,
  BridgeAbortError,
  RuntimeDefectError,
  RuntimeChatStreamNotFoundError,
  JsonValueSchema,
  RuntimeUpstreamServiceError,
  decodeSupportedUrls,
  type BridgePermissionRequest,
  type BridgeModelDescriptorResponse,
  type PageBridgeRpc,
  type RuntimeChatCallOptions,
  type RuntimeCreatePermissionRequestResponse,
  type RuntimeModelSummary,
  type RuntimeRpcError,
  type PageBridgePortControlMessage,
  type JsonValue,
} from "@llm-bridge/contracts";
import { makeResettableConnectionLifecycle } from "@llm-bridge/runtime-core";
import {
  validateUIMessages,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import {
  APICallError,
  type LanguageModelV3,
  type LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import * as RpcClient from "@effect/rpc/RpcClient";
import { RpcClientError } from "@effect/rpc/RpcClientError";
import type {
  FromClientEncoded,
  FromServerEncoded,
} from "@effect/rpc/RpcMessage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
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

export type BridgeChatTransportPrepareSendMessagesArgs = {
  chatId: string;
  modelId: string;
  messages: ReadonlyArray<UIMessage>;
  trigger: "submit-message" | "regenerate-message";
  messageId: string | undefined;
  body: object | undefined;
  metadata: UIMessage["metadata"] | undefined;
};

export type BridgeChatTransportOptions = {
  prepareSendMessages?: (
    args: BridgeChatTransportPrepareSendMessagesArgs,
  ) => RuntimeChatCallOptions | Promise<RuntimeChatCallOptions>;
};

export type BridgeModelSummary = RuntimeModelSummary;
export type BridgePermissionResult = RuntimeCreatePermissionRequestResponse;

const decodeJsonValue = Schema.decodeUnknownSync(JsonValueSchema);

function createAbortError() {
  return new BridgeAbortError({
    message: "The operation was aborted",
  });
}

function createUnsupportedChatTransportHeadersError() {
  return new RuntimeValidationError({
    message:
      "Bridge chat transport does not support per-request headers. Use prepareSendMessages to set model call headers instead.",
  });
}

function createMissingChatModelIdError() {
  return new RuntimeValidationError({
    message:
      "Bridge chat transport requires request body.modelId to be a non-empty string.",
  });
}

function createBridgeModelCallUrl(
  operation: "generate" | "stream",
  modelId: string,
) {
  return `llm-bridge://${operation}/${encodeURIComponent(modelId)}`;
}

function toResponseHeaders(error: RuntimeUpstreamServiceError) {
  if (
    error.responseHeaders &&
    Object.keys(error.responseHeaders).length > 0
  ) {
    return error.responseHeaders;
  }
  return undefined;
}

function normalizeModelCallError(input: {
  error: unknown;
  operation: "generate" | "stream";
  modelId: string;
  requestBodyValues: unknown;
}) {
  if (!(input.error instanceof RuntimeUpstreamServiceError)) {
    return input.error;
  }

  return new APICallError({
    message: input.error.message,
    url: createBridgeModelCallUrl(input.operation, input.modelId),
    requestBodyValues: input.requestBodyValues,
    statusCode: input.error.statusCode,
    responseHeaders: toResponseHeaders(input.error),
    isRetryable: input.error.retryable,
    cause: input.error,
  });
}

function isBootstrapRuntimeStreamPart(part: { type: string }) {
  return (
    part.type === "stream-start" ||
    part.type === "response-metadata" ||
    part.type === "raw"
  );
}

function isJsonObject(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOpaqueJsonObject(
  value: object,
  operation: string,
): { readonly [key: string]: JsonValue } {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new RuntimeValidationError({
      message: `${operation} must be JSON serializable`,
    });
  }

  const parsed = decodeJsonValue(JSON.parse(serialized));
  if (!isJsonObject(parsed)) {
    throw new RuntimeValidationError({
      message: `${operation} must encode to a JSON object`,
    });
  }

  return parsed;
}

function hasRequestHeaders(headers: Headers | Record<string, string> | undefined) {
  if (!headers) {
    return false;
  }

  if (headers instanceof Headers) {
    return [...headers.keys()].length > 0;
  }

  return Object.keys(headers).length > 0;
}

function toBridgeDefect(error: RuntimeRpcError | Error): RuntimeRpcError | Error {
  return error instanceof Error
    ? error
    : new RuntimeDefectError({
        defect: String(error),
      });
}

function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveChatRequestModelId(input: {
  body: object | undefined;
}): {
  modelId: string;
  bodyWithoutModelId: object | undefined;
} {
  if (!isObjectRecord(input.body)) {
    throw createMissingChatModelIdError();
  }

  const modelId = input.body.modelId;
  if (typeof modelId !== "string" || modelId.trim().length === 0) {
    throw createMissingChatModelIdError();
  }

  const { modelId: _modelId, ...bodyWithoutModelId } = input.body;

  return {
    modelId,
    bodyWithoutModelId:
      Object.keys(bodyWithoutModelId).length > 0 ? bodyWithoutModelId : undefined,
  };
}

function createChatReadableStream(input: {
  chatId: string;
  reader: ReadableStreamDefaultReader<{ readonly [key: string]: JsonValue }>;
  abortSignal?: AbortSignal;
  abortChatStream: (chatId: string) => Promise<void>;
  bufferedChunk?: { readonly [key: string]: JsonValue };
  streamFinished?: boolean;
}): ReadableStream<UIMessageChunk> {
  let bufferedChunk = input.bufferedChunk;
  let streamFinished = input.streamFinished ?? false;

  const abortActiveChatStream = () =>
    input.abortChatStream(input.chatId).catch(() => undefined);

  const onAbort = () => {
    void abortActiveChatStream();
  };

  input.abortSignal?.addEventListener("abort", onAbort, { once: true });

  const cleanup = () => {
    input.abortSignal?.removeEventListener("abort", onAbort);
  };

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        if (bufferedChunk) {
          controller.enqueue(bufferedChunk as UIMessageChunk);
          bufferedChunk = undefined;
          return;
        }

        if (streamFinished) {
          cleanup();
          controller.close();
          return;
        }

        const next = await input.reader.read();
        if (next.done) {
          streamFinished = true;
          cleanup();
          controller.close();
          return;
        }

        // The runtime contract constrains chat chunks to JSON objects.
        // The extension side produces these chunks from AI SDK UI streams.
        controller.enqueue(next.value as UIMessageChunk);
      } catch (error) {
        cleanup();
        throw toBridgeDefect(
          error instanceof Error
            ? error
            : new RuntimeDefectError({
                defect: String(error),
              }),
        );
      }
    },
    async cancel() {
      try {
        await input.reader.cancel();
      } finally {
        cleanup();
        void abortActiveChatStream();
      }
    },
  });
}

function logBridgeDebug(event: string, details?: unknown) {
  console.log(`[bridge-client] ${event}`, details);
}

function logBridgeError(event: string, error: unknown, details?: unknown) {
  console.error(`[bridge-client] ${event}`, {
    details,
    error,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

function waitForBridgeReady(timeoutMs: number) {
  return Effect.async<void, BridgeInitializationTimeoutError>((resume) => {
    if (typeof window === "undefined") {
      resume(Effect.void);
      return;
    }

    if (document.documentElement.dataset.llmBridgeReady === "true") {
      resume(Effect.void);
      return;
    }

    const timer = window.setTimeout(() => {
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

  return Effect.gen(function* () {
    yield* waitForBridgeReady(timeoutMs);

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
      ).pipe(Scope.extend(runtimeScope));

      const client = yield* RpcClient.make(PageBridgeRpcGroup, {
        disableTracing: true,
      }).pipe(
        Effect.provideService(RpcClient.Protocol, protocol),
        Scope.extend(runtimeScope),
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

function nextRequestId(sequence: number) {
  return `req_${Date.now()}_${sequence}`;
}

function makeBridgeClientApi(input: {
  ensureConnection: Effect.Effect<BridgeConnection, RuntimeRpcError>;
  destroy: Effect.Effect<void, never>;
  abortChatStream: (chatId: string) => Promise<void>;
  createLanguageModel: (
    modelId: string,
    descriptor: BridgeModelDescriptorResponse,
  ) => LanguageModelV3;
  nextModelRequestId: () => string;
}) {
  const listModels = input.ensureConnection.pipe(
    Effect.flatMap((current) => current.client.listModels({})),
    Effect.map((response) => response.models),
  );

  const requestPermission = (payload: BridgePermissionRequest) =>
    input.ensureConnection.pipe(
      Effect.flatMap((current) => current.client.requestPermission(payload)),
    );

  const getModel = (modelId: string) =>
    Effect.gen(function* () {
      const requestId = input.nextModelRequestId();
      const current = yield* input.ensureConnection;
      const descriptor = yield* current.client.getModel({
        modelId,
        requestId,
        sessionID: requestId,
      });

      return input.createLanguageModel(modelId, descriptor);
    });

  const getChatTransport = (
    options: BridgeChatTransportOptions = {},
  ): ChatTransport<UIMessage> => ({
    async sendMessages({
      chatId,
      trigger,
      messageId,
      messages,
      abortSignal,
      headers,
      body,
      metadata,
    }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]) {
      if (hasRequestHeaders(headers)) {
        throw createUnsupportedChatTransportHeadersError();
      }

      const validatedMessages = await validateUIMessages({
        messages,
      });

      const {
        modelId,
        bodyWithoutModelId,
      } = resolveChatRequestModelId({
        body,
      });

      const runtimeOptions = options.prepareSendMessages
        ? await options.prepareSendMessages({
            chatId,
            modelId,
            messages: validatedMessages,
            trigger,
            messageId,
            body: bodyWithoutModelId,
            metadata,
          })
        : undefined;

      const runtimeStream = await Effect.runPromise(
        Effect.gen(function* () {
          const current = yield* input.ensureConnection;

          return yield* Effect.scoped(
            Stream.toReadableStreamEffect(
              current.client.chatSendMessages({
                chatId,
                modelId,
                trigger,
                messageId,
                messages: validatedMessages.map((message: UIMessage) =>
                  toOpaqueJsonObject(message, "chat message"),
                ),
                options: runtimeOptions,
              }),
            ),
          );
        }),
      );

      return createChatReadableStream({
        chatId,
        reader: runtimeStream.getReader(),
        abortSignal,
        abortChatStream: input.abortChatStream,
      });
    },
    async reconnectToStream({
      chatId,
      headers,
    }: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0]) {
      if (hasRequestHeaders(headers)) {
        throw createUnsupportedChatTransportHeadersError();
      }

      try {
        const runtimeStream = await Effect.runPromise(
          Effect.gen(function* () {
            const current = yield* input.ensureConnection;

            return yield* Effect.scoped(
              Stream.toReadableStreamEffect(
                current.client.chatReconnectStream({
                  chatId,
                }),
              ),
            );
          }),
        );

        const reader = runtimeStream.getReader();
        const firstChunk = await reader.read();

        return createChatReadableStream({
          chatId,
          reader,
          bufferedChunk: firstChunk.done ? undefined : firstChunk.value,
          streamFinished: firstChunk.done,
          abortChatStream: input.abortChatStream,
        });
      } catch (error) {
        if (error instanceof RuntimeChatStreamNotFoundError) {
          return null;
        }

        throw error;
      }
    },
  });

  return {
    listModels,
    getModel,
    getChatTransport,
    requestPermission,
    destroy: input.destroy,
  };
}

export type BridgeClientApi = ReturnType<typeof makeBridgeClientApi>;

export class BridgeClient extends Context.Tag(
  "@llm-bridge/client/BridgeClient",
)<BridgeClient, BridgeClientApi>() {}

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

      const abortRequest = (input: { requestId: string; sessionID: string }) =>
        ensureConnection.pipe(
          Effect.flatMap((current) =>
            current.client.abort({
              requestId: input.requestId,
              sessionID: input.sessionID,
            }),
          ),
          Effect.asVoid,
        );

      const abortChatStream = (chatId: string) =>
        Effect.runPromise(
          ensureConnection.pipe(
            Effect.flatMap((current) =>
              current.client.abortChatStream({
                chatId,
              }),
            ),
            Effect.asVoid,
          ),
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
          const runtimeOptions = toRuntimeModelCallOptions(options);
          logBridgeDebug("doGenerate.started", { modelId, requestId });

          if (abortSignal?.aborted) {
            throw createAbortError();
          }

          const onAbort = () => {
            void Effect.runPromise(
              abortRequest({
                requestId,
                sessionID: requestId,
              }),
            ).catch(() => undefined);
          };

          abortSignal?.addEventListener("abort", onAbort, { once: true });

          try {
            const response = await Effect.runPromise(
              Effect.gen(function* () {
                if (abortSignal?.aborted) {
                  return yield* Effect.fail(createAbortError());
                }

                const current = yield* ensureConnection;
                const generated = yield* current.client.modelDoGenerate({
                  requestId,
                  sessionID: requestId,
                  modelId,
                  options: runtimeOptions,
                });

                return fromRuntimeGenerateResponse(generated);
              }),
            );

            logBridgeDebug("doGenerate.succeeded", { modelId, requestId });
            return response;
          } catch (error) {
            const normalized = normalizeModelCallError({
              error,
              operation: "generate",
              modelId,
              requestBodyValues: runtimeOptions,
            });
            logBridgeError("doGenerate.failed", normalized, {
              modelId,
              requestId,
            });
            throw normalized;
          } finally {
            abortSignal?.removeEventListener("abort", onAbort);
          }
        },
        async doStream(options) {
          sequence += 1;
          const requestId = nextRequestId(sequence);
          const abortSignal = options.abortSignal;
          const runtimeOptions = toRuntimeModelCallOptions(options);
          logBridgeDebug("doStream.started", { modelId, requestId });

          if (abortSignal?.aborted) {
            throw createAbortError();
          }

          try {
            const runtimeStream = await Effect.runPromise(
              Effect.gen(function* () {
                if (abortSignal?.aborted) {
                  return yield* Effect.fail(createAbortError());
                }

                const current = yield* ensureConnection;
                return yield* Effect.scoped(
                  Stream.toReadableStreamEffect(
                    current.client.modelDoStream({
                      requestId,
                      sessionID: requestId,
                      modelId,
                      options: runtimeOptions,
                    }),
                  ),
                );
              }),
            );

            const reader = runtimeStream.getReader();
            const onAbort = () => {
              void Effect.runPromise(
                abortRequest({
                  requestId,
                  sessionID: requestId,
                }),
              ).catch(() => undefined);
            };

            abortSignal?.addEventListener("abort", onAbort, { once: true });

            const cleanup = () => {
              abortSignal?.removeEventListener("abort", onAbort);
            };

            const bufferedParts = [] as Array<LanguageModelV3StreamPart>;
            let streamFinishedDuringBootstrap = false;

            while (true) {
              const next = await reader.read();
              if (next.done) {
                streamFinishedDuringBootstrap = true;
                break;
              }

              const part = fromRuntimeStreamPart(next.value);
              bufferedParts.push(part);
              if (!isBootstrapRuntimeStreamPart(part)) {
                break;
              }
            }

            let bufferedIndex = 0;
            let completed = false;

            const finishStream = () => {
              if (completed) return;
              completed = true;
              cleanup();
              logBridgeDebug("doStream.completed", {
                modelId,
                requestId,
              });
            };

            return {
              stream: new ReadableStream<LanguageModelV3StreamPart>({
                async pull(controller) {
                  if (bufferedIndex < bufferedParts.length) {
                    controller.enqueue(bufferedParts[bufferedIndex]!);
                    bufferedIndex += 1;
                    return;
                  }

                  if (streamFinishedDuringBootstrap) {
                    finishStream();
                    controller.close();
                    return;
                  }

                  try {
                    const next = await reader.read();
                    if (next.done) {
                      finishStream();
                      controller.close();
                      return;
                    }
                    controller.enqueue(fromRuntimeStreamPart(next.value));
                  } catch (error) {
                    cleanup();
                    const normalized = normalizeModelCallError({
                      error,
                      operation: "stream",
                      modelId,
                      requestBodyValues: runtimeOptions,
                    });
                    logBridgeError("doStream.pullFailed", normalized, {
                      modelId,
                      requestId,
                    });
                    throw normalized;
                  }
                },
                async cancel() {
                  try {
                    logBridgeDebug("doStream.canceled", {
                      modelId,
                      requestId,
                    });
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
          } catch (error) {
            const normalized = normalizeModelCallError({
              error,
              operation: "stream",
              modelId,
              requestBodyValues: runtimeOptions,
            });
            logBridgeError("doStream.failed", normalized, {
              modelId,
              requestId,
            });
            throw normalized;
          }
        },
      });

      return makeBridgeClientApi({
        ensureConnection,
        destroy,
        abortChatStream,
        createLanguageModel,
        nextModelRequestId: () => {
          sequence += 1;
          return nextRequestId(sequence);
        },
      });
    }),
  );
}

export function withBridgeClient<R, E, A>(
  effect: Effect.Effect<A, E, R | BridgeClient>,
  options: BridgeClientOptions = {},
): Effect.Effect<A, E, Exclude<R, BridgeClient>> {
  return effect.pipe(Effect.provide(BridgeClientLive(options)));
}
