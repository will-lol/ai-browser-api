import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type ModelMessage,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import {
  APICallError,
  type LanguageModelV3,
  type LanguageModelV3CallOptions,
} from "@ai-sdk/provider";
import { RetryError } from "ai";
import {
  RuntimeChatStreamNotFoundError,
  RuntimeValidationError,
  JsonValueSchema,
  isRuntimeRpcError,
  type JsonValue,
  type RuntimeAbortChatStreamInput,
  type RuntimeChatReconnectStreamInput,
  type RuntimeChatSendMessagesInput,
  type RuntimeChatStreamChunk,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import {
  ensureModelAccess,
  ensureOriginEnabled,
} from "@llm-bridge/runtime-core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  prepareRuntimeChatModelCall,
  type PreparedRuntimeChatModelCall,
} from "@/background/runtime/execution/language-model-runtime";
import {
  wrapExtensionError,
  wrapProviderError,
} from "@/background/runtime/core/errors";

const decodeJsonValue = Schema.decodeUnknownSync(JsonValueSchema);

type ChatSubscriber = {
  controller: ReadableStreamDefaultController<RuntimeChatStreamChunk>;
};

type ChatGenerationFinalState =
  | {
      _tag: "success";
    }
  | {
      _tag: "failure";
      error: RuntimeRpcError;
    };

type ActiveChatGeneration = {
  key: string;
  origin: string;
  chatId: string;
  abortController: AbortController;
  bufferedChunks: Array<RuntimeChatStreamChunk>;
  subscribers: Set<ChatSubscriber>;
  finalState: ChatGenerationFinalState | null;
};

type ChatExecutionServiceDeps = {
  prepareLanguageModelCall: (input: {
    modelID: string;
    origin: string;
    sessionID: string;
    requestID: string;
    messages: Array<ModelMessage>;
    options?: Parameters<typeof prepareRuntimeChatModelCall>[0]["options"];
  }) => Effect.Effect<PreparedRuntimeChatModelCall, RuntimeRpcError>;
  convertMessages: typeof convertToModelMessages;
  validateMessages: typeof validateUIMessages;
  streamTextImpl: typeof streamText;
};

type StreamTextInput = Parameters<typeof streamText>[0];

function logChatDebug(event: string, details?: object) {
  console.log(`[chat-execution-service] ${event}`, details);
}

function logChatError(event: string, error: Error, details?: object) {
  console.error(`[chat-execution-service] ${event}`, {
    details,
    error,
    message: error.message,
    stack: error.stack,
  });
}

function nextChatRequestId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toGenerationKey(input: { origin: string; chatId: string }) {
  return `${input.origin}::${input.chatId}`;
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

function mergePreparedCallOptions(
  options: LanguageModelV3CallOptions,
  preparedCallOptions: PreparedRuntimeChatModelCall["callOptions"],
): LanguageModelV3CallOptions {
  return {
    ...options,
    ...preparedCallOptions,
    abortSignal: options.abortSignal,
  };
}

function createPreparedLanguageModel(input: {
  languageModel: LanguageModelV3;
  preparedCallOptions: PreparedRuntimeChatModelCall["callOptions"];
}): LanguageModelV3 {
  return {
    specificationVersion: input.languageModel.specificationVersion,
    provider: input.languageModel.provider,
    modelId: input.languageModel.modelId,
    supportedUrls: input.languageModel.supportedUrls,
    doGenerate: (options) =>
      input.languageModel.doGenerate(
        mergePreparedCallOptions(options, input.preparedCallOptions),
      ),
    doStream: (options) =>
      input.languageModel.doStream(
        mergePreparedCallOptions(options, input.preparedCallOptions),
      ),
  };
}

function toStreamTextInput(input: {
  languageModel: LanguageModelV3;
  abortSignal: AbortSignal;
  messages: Awaited<ReturnType<typeof convertToModelMessages>>;
}): StreamTextInput {
  return {
    model: input.languageModel,
    abortSignal: input.abortSignal,
    messages: input.messages,
  };
}

function toRuntimeChatError(input: {
  error: RuntimeRpcError | Error;
  operation: string;
  providerID?: string;
}): RuntimeRpcError {
  if (isRuntimeRpcError(input.error)) {
    return input.error;
  }

  if (
    input.providerID &&
    (APICallError.isInstance(input.error) || RetryError.isInstance(input.error))
  ) {
    return wrapProviderError(input.error, input.providerID, input.operation);
  }

  return wrapExtensionError(input.error, input.operation);
}

function ensureNotAborted(
  generation: ActiveChatGeneration,
): Effect.Effect<void, RuntimeValidationError> {
  if (!generation.abortController.signal.aborted) {
    return Effect.void;
  }

  return Effect.fail(
    new RuntimeValidationError({
      message: `${generation} aborted`,
    }),
  );
}

function broadcastChunk(
  generation: ActiveChatGeneration,
  chunk: RuntimeChatStreamChunk,
) {
  generation.bufferedChunks.push(chunk);

  for (const subscriber of generation.subscribers) {
    try {
      subscriber.controller.enqueue(chunk);
    } catch {
      generation.subscribers.delete(subscriber);
    }
  }
}

function finalizeGeneration(
  generation: ActiveChatGeneration,
  generations: Map<string, ActiveChatGeneration>,
  finalState: ChatGenerationFinalState,
) {
  if (generation.finalState !== null) {
    return;
  }

  generation.finalState = finalState;

  if (generations.get(generation.key) === generation) {
    generations.delete(generation.key);
  }

  for (const subscriber of generation.subscribers) {
    try {
      if (finalState._tag === "success") {
        subscriber.controller.close();
      } else {
        subscriber.controller.error(finalState.error);
      }
    } catch {
      // ignored
    }
  }

  generation.subscribers.clear();
}

function subscribeToGeneration(input: {
  generation: ActiveChatGeneration;
  generations: Map<string, ActiveChatGeneration>;
}): ReadableStream<RuntimeChatStreamChunk> {
  let subscriber: ChatSubscriber | null = null;

  return new ReadableStream<RuntimeChatStreamChunk>({
    start(controller) {
      subscriber = {
        controller,
      };

      for (const chunk of input.generation.bufferedChunks) {
        controller.enqueue(chunk);
      }

      if (input.generation.finalState?._tag === "success") {
        controller.close();
        return;
      }

      if (input.generation.finalState?._tag === "failure") {
        controller.error(input.generation.finalState.error);
        return;
      }

      input.generation.subscribers.add(subscriber);
    },
    cancel() {
      if (subscriber) {
        input.generation.subscribers.delete(subscriber);
      }

      if (!input.generation.abortController.signal.aborted) {
        input.generation.abortController.abort();
      }

      if (input.generations.get(input.generation.key) === input.generation) {
        input.generations.delete(input.generation.key);
      }
    },
  });
}

function startGenerationPump(input: {
  generation: ActiveChatGeneration;
  generations: Map<string, ActiveChatGeneration>;
  stream: ReadableStream<UIMessageChunk>;
  providerID: string;
}) {
  const reader = input.stream.getReader();

  void (async () => {
    try {
      while (true) {
        const next = await reader.read();

        if (next.done) {
          finalizeGeneration(input.generation, input.generations, {
            _tag: "success",
          });
          return;
        }

        broadcastChunk(
          input.generation,
          toOpaqueJsonObject(next.value, "chat stream chunk"),
        );
      }
    } catch (error) {
      if (input.generation.abortController.signal.aborted) {
        finalizeGeneration(input.generation, input.generations, {
          _tag: "success",
        });
        return;
      }

      const normalizedError =
        error instanceof Error
          ? toRuntimeChatError({
              error,
              providerID: input.providerID,
              operation: "chat.stream",
            })
          : wrapExtensionError(String(error), "chat.stream");

      if (normalizedError instanceof Error) {
        logChatError("stream.failed", normalizedError, {
          chatId: input.generation.chatId,
          origin: input.generation.origin,
        });
      }

      finalizeGeneration(input.generation, input.generations, {
        _tag: "failure",
        error: normalizedError,
      });
    } finally {
      reader.releaseLock();
    }
  })();
}

function makeChatExecutionService(input: ChatExecutionServiceDeps) {
  const generations = new Map<string, ActiveChatGeneration>();

  const abortGeneration = (request: RuntimeAbortChatStreamInput) =>
    Effect.sync(() => {
      const generation = generations.get(toGenerationKey(request));
      if (!generation) {
        return;
      }

      generation.abortController.abort();
    });

  const sendMessages = (request: RuntimeChatSendMessagesInput) =>
    Effect.gen(function* () {
      const generationKey = toGenerationKey(request);
      const existing = generations.get(generationKey);
      if (existing) {
        existing.abortController.abort();
      }

      const generation: ActiveChatGeneration = {
        key: generationKey,
        origin: request.origin,
        chatId: request.chatId,
        abortController: new AbortController(),
        bufferedChunks: [],
        subscribers: new Set<ChatSubscriber>(),
        finalState: null,
      };

      generations.set(generationKey, generation);

      const requestID = nextChatRequestId();
      const sessionID = request.chatId;

      const result = yield* Effect.gen(function* () {
        yield* ensureOriginEnabled(request.origin);
        yield* ensureModelAccess({
          origin: request.origin,
          modelID: request.modelId,
          signal: generation.abortController.signal,
        });

        const validatedMessages = yield* Effect.tryPromise({
          try: () =>
            input.validateMessages<UIMessage>({
              messages: request.messages,
            }),
          catch: (error) =>
            new RuntimeValidationError({
              message:
                error instanceof Error
                  ? error.message
                  : "Chat messages failed validation",
            }),
        });

        const modelMessages = yield* Effect.tryPromise({
          try: () => input.convertMessages(validatedMessages),
          catch: (error) =>
            new RuntimeValidationError({
              message:
                error instanceof Error
                  ? error.message
                  : "Chat messages could not be converted",
            }),
        });

        const preparedCall = yield* input
          .prepareLanguageModelCall({
            modelID: request.modelId,
            origin: request.origin,
            sessionID,
            requestID,
            messages: modelMessages,
            options: request.options,
          })
          .pipe(
            Effect.catchAllDefect((error) =>
              Effect.fail(
                toRuntimeChatError({
                  error:
                    error instanceof Error ? error : new Error(String(error)),
                  operation: "chat.prepareLanguageModelCall",
                }),
              ),
            ),
          );

        yield* ensureNotAborted(generation);
        const result = yield* Effect.try({
          try: () => {
            const preparedLanguageModel = createPreparedLanguageModel({
              languageModel: preparedCall.languageModel,
              preparedCallOptions: preparedCall.callOptions,
            });

            return input.streamTextImpl(
              toStreamTextInput({
                languageModel: preparedLanguageModel,
                abortSignal: generation.abortController.signal,
                messages: modelMessages,
              }),
            );
          },
          catch: (error) =>
            toRuntimeChatError({
              error: error instanceof Error ? error : new Error(String(error)),
              providerID: preparedCall.providerID,
              operation: "chat.streamText",
            }),
        });

        return yield* Effect.try({
          try: () => ({
            uiStream: result.toUIMessageStream({
              originalMessages: validatedMessages,
            }),
            providerID: preparedCall.providerID,
          }),
          catch: (error) =>
            toRuntimeChatError({
              error: error instanceof Error ? error : new Error(String(error)),
              providerID: preparedCall.providerID,
              operation: "chat.toUIMessageStream",
            }),
        });
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            const runtimeError = isRuntimeRpcError(error)
              ? error
              : toRuntimeChatError({
                  error:
                    error instanceof Error ? error : new Error(String(error)),
                  operation: "chat.sendMessages",
                });
            finalizeGeneration(generation, generations, {
              _tag: "failure",
              error: runtimeError,
            });
          }),
        ),
      );

      logChatDebug("send.started", {
        chatId: request.chatId,
        modelId: request.modelId,
        origin: request.origin,
        requestID,
      });

      startGenerationPump({
        generation,
        generations,
        stream: result.uiStream,
        providerID: result.providerID,
      });

      return subscribeToGeneration({
        generation,
        generations,
      });
    });

  const reconnectStream = (request: RuntimeChatReconnectStreamInput) =>
    Effect.gen(function* () {
      const generation = generations.get(toGenerationKey(request));
      if (!generation) {
        return yield* Effect.fail(
          new RuntimeChatStreamNotFoundError({
            origin: request.origin,
            chatId: request.chatId,
            message: `No active chat stream found for ${request.chatId}`,
          }),
        );
      }

      return subscribeToGeneration({
        generation,
        generations,
      });
    });

  return {
    sendMessages,
    reconnectStream,
    abortStream: abortGeneration,
  };
}

type ChatExecutionServiceApi = ReturnType<typeof makeChatExecutionService>;

export class ChatExecutionService extends Context.Tag(
  "@llm-bridge/extension/ChatExecutionService",
)<ChatExecutionService, ChatExecutionServiceApi>() {}

export const ChatExecutionServiceLive = Layer.effect(
  ChatExecutionService,
  Effect.succeed(
    makeChatExecutionService({
      prepareLanguageModelCall: prepareRuntimeChatModelCall,
      convertMessages: convertToModelMessages,
      validateMessages: validateUIMessages,
      streamTextImpl: streamText,
    }),
  ),
);
