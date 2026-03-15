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
  JsonValueSchema,
  RuntimeChatStreamNotFoundError,
  RuntimeValidationError,
  isRuntimeRpcError,
  type JsonValue,
  type RuntimeAbortChatStreamInput,
  type RuntimeChatReconnectStreamInput,
  type RuntimeChatSendMessagesInput,
  type RuntimeChatStreamChunk,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import {
  ChatExecutionService,
  ensureModelAccess,
  ensureOriginEnabled,
  type ChatExecutionServiceApi,
} from "@llm-bridge/runtime-core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import {
  prepareRuntimeChatModelCall,
  type PreparedRuntimeChatModelCall,
} from "@/background/runtime/execution/language-model-runtime";
import { readableStreamToEffectStream } from "@/background/runtime/interop/ai-sdk-interop";
import {
  wrapExtensionError,
  wrapProviderError,
} from "@/background/runtime/core/errors";

const decodeJsonValue = Schema.decodeUnknownSync(JsonValueSchema);

type ChatTerminalEvent =
  | {
      _tag: "success";
    }
  | {
      _tag: "failure";
      error: RuntimeRpcError;
    };

type ChatEvent =
  | {
      _tag: "chunk";
      chunk: RuntimeChatStreamChunk;
    }
  | ChatTerminalEvent;

type ActiveChatGeneration = {
  readonly key: string;
  readonly origin: string;
  readonly chatId: string;
  readonly abortController: AbortController;
  readonly events: PubSub.PubSub<ChatEvent>;
  readonly subscriberCount: Ref.Ref<number>;
  readonly terminalEventRef: Ref.Ref<ChatTerminalEvent | null>;
  readonly producerFiberRef: SynchronizedRef.SynchronizedRef<
    Fiber.RuntimeFiber<void, never> | null
  >;
  readonly startProducer: () => Effect.Effect<
    Fiber.RuntimeFiber<void, never>,
    never
  >;
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

type PreparedChatGeneration = {
  readonly providerID: string;
  readonly uiStream: ReadableStream<UIMessageChunk>;
};

function logChatDebug(event: string, details?: Record<string, unknown>) {
  console.log(`[chat-execution-service] ${event}`, details);
}

function logChatError(
  event: string,
  error: Error,
  details?: Record<string, unknown>,
) {
  console.error(`[chat-execution-service] ${event}`, {
    details,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
  });
}

function nextChatRequestId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toGenerationKey(input: { origin: string; chatId: string }) {
  return `${input.origin}::${input.chatId}`;
}

function toChatStreamNotFoundError(input: {
  origin: string;
  chatId: string;
}) {
  return new RuntimeChatStreamNotFoundError({
    origin: input.origin,
    chatId: input.chatId,
    message: `No active chat stream found for ${input.chatId}`,
  });
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

function ensureSignalNotAborted(
  signal: AbortSignal,
): Effect.Effect<void, RuntimeValidationError> {
  if (!signal.aborted) {
    return Effect.void;
  }

  return Effect.fail(
    new RuntimeValidationError({
      message: "Request canceled",
    }),
  );
}

function eventToStream(
  event: ChatEvent,
): Stream.Stream<RuntimeChatStreamChunk, RuntimeRpcError> {
  switch (event._tag) {
    case "chunk":
      return Stream.succeed(event.chunk);
    case "success":
      return Stream.empty;
    case "failure":
      return Stream.fail(event.error);
  }
}

function normalizeChatStreamFailure(input: {
  error: unknown;
  providerID: string;
}): RuntimeRpcError {
  if (isRuntimeRpcError(input.error)) {
    return input.error;
  }

  if (input.error instanceof Error) {
    return toRuntimeChatError({
      error: input.error,
      providerID: input.providerID,
      operation: "chat.stream",
    });
  }

  return wrapExtensionError(String(input.error), "chat.stream");
}

function prepareChatGeneration(input: {
  deps: ChatExecutionServiceDeps;
  request: RuntimeChatSendMessagesInput;
  abortController: AbortController;
  requestID: string;
  sessionID: string;
}) {
  return Effect.gen(function* () {
    yield* ensureOriginEnabled(input.request.origin);
    yield* ensureModelAccess({
      origin: input.request.origin,
      modelID: input.request.modelId,
      signal: input.abortController.signal,
    });

    const validatedMessages = yield* Effect.tryPromise({
      try: () =>
        input.deps.validateMessages<UIMessage>({
          messages: input.request.messages,
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
      try: () => input.deps.convertMessages(validatedMessages),
      catch: (error) =>
        new RuntimeValidationError({
          message:
            error instanceof Error
              ? error.message
              : "Chat messages could not be converted",
        }),
    });

    const preparedCall = yield* input.deps
      .prepareLanguageModelCall({
        modelID: input.request.modelId,
        origin: input.request.origin,
        sessionID: input.sessionID,
        requestID: input.requestID,
        messages: modelMessages,
        options: input.request.options,
      })
      .pipe(
        Effect.catchAllDefect((error) =>
          Effect.fail(
            toRuntimeChatError({
              error: error instanceof Error ? error : new Error(String(error)),
              operation: "chat.prepareLanguageModelCall",
            }),
          ),
        ),
      );

    yield* ensureSignalNotAborted(input.abortController.signal);

    const streamTextResult = yield* Effect.try({
      try: () => {
        const preparedLanguageModel = createPreparedLanguageModel({
          languageModel: preparedCall.languageModel,
          preparedCallOptions: preparedCall.callOptions,
        });

        return input.deps.streamTextImpl(
          toStreamTextInput({
            languageModel: preparedLanguageModel,
            abortSignal: input.abortController.signal,
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
        uiStream: streamTextResult.toUIMessageStream({
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
    Effect.mapError((error) =>
      isRuntimeRpcError(error)
        ? error
        : wrapExtensionError(error, "chat.sendMessages"),
    ),
  );
}

function makeGenerationState(input: {
  generationKey: string;
  origin: string;
  chatId: string;
  abortController: AbortController;
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>;
  producerFibers: FiberSet.FiberSet<void, never>;
  prepared: PreparedChatGeneration;
}): Effect.Effect<ActiveChatGeneration> {
  return Effect.gen(function* () {
    const events = yield* PubSub.unbounded<ChatEvent>();
    const subscriberCount = yield* Ref.make(0);
    const terminalEventRef = yield* Ref.make<ChatTerminalEvent | null>(null);
    const producerFiberRef = yield* SynchronizedRef.make<
      Fiber.RuntimeFiber<void, never> | null
    >(null);

    const generation: ActiveChatGeneration = {
      key: input.generationKey,
      origin: input.origin,
      chatId: input.chatId,
      abortController: input.abortController,
      events,
      subscriberCount,
      terminalEventRef,
      producerFiberRef,
      startProducer: () =>
        FiberSet.run(
          input.producerFibers,
          produceGeneration({
            registryRef: input.registryRef,
            generation,
            stream: input.prepared.uiStream,
            providerID: input.prepared.providerID,
          }),
        ),
    };

    return generation;
  });
}

function getGeneration(
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>,
  key: string,
) {
  return SynchronizedRef.get(registryRef).pipe(
    Effect.flatMap((registry) => Effect.fromNullable(registry.get(key))),
  );
}

function replaceGeneration(
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>,
  generation: ActiveChatGeneration,
) {
  return SynchronizedRef.modify(registryRef, (registry) => {
    const nextRegistry = new Map(registry);
    const existing = nextRegistry.get(generation.key);
    nextRegistry.set(generation.key, generation);
    return [existing, nextRegistry] as const;
  });
}

function takeGeneration(
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>,
  key: string,
) {
  return SynchronizedRef.modify(registryRef, (registry) => {
    const existing = registry.get(key);
    if (!existing) {
      return [undefined, registry] as const;
    }

    const nextRegistry = new Map(registry);
    nextRegistry.delete(key);
    return [existing, nextRegistry] as const;
  });
}

function removeGenerationIfCurrent(input: {
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>;
  generation: ActiveChatGeneration;
}) {
  return SynchronizedRef.modify(input.registryRef, (registry) => {
    if (registry.get(input.generation.key) !== input.generation) {
      return [false, registry] as const;
    }

    const nextRegistry = new Map(registry);
    nextRegistry.delete(input.generation.key);
    return [true, nextRegistry] as const;
  });
}

function publishChunkEvent(
  generation: ActiveChatGeneration,
  chunk: RuntimeChatStreamChunk,
) {
  return Effect.gen(function* () {
    const shouldPublish = yield* Ref.modify(
      generation.terminalEventRef,
      (current) => [current === null, current] as const,
    );
    if (!shouldPublish) {
      return;
    }

    yield* PubSub.publish(generation.events, {
      _tag: "chunk",
      chunk,
    }).pipe(Effect.asVoid);
  });
}

function finishGeneration(input: {
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>;
  generation: ActiveChatGeneration;
  event: ChatTerminalEvent;
}) {
  return Effect.gen(function* () {
    const existingTerminal = yield* Ref.modify(
      input.generation.terminalEventRef,
      (current) => [current, current ?? input.event] as const,
    );
    if (existingTerminal) {
      return;
    }

    yield* removeGenerationIfCurrent(input);
    yield* PubSub.publish(input.generation.events, input.event).pipe(
      Effect.asVoid,
    );
  });
}

function interruptProducer(generation: ActiveChatGeneration) {
  return SynchronizedRef.get(generation.producerFiberRef).pipe(
    Effect.flatMap((fiber) =>
      fiber ? Fiber.interrupt(fiber).pipe(Effect.asVoid) : Effect.void,
    ),
  );
}

function abortGeneration(input: {
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>;
  generation: ActiveChatGeneration;
}) {
  return Effect.gen(function* () {
    yield* Effect.sync(() => {
      input.generation.abortController.abort();
    });
    yield* interruptProducer(input.generation);
    yield* finishGeneration({
      registryRef: input.registryRef,
      generation: input.generation,
      event: {
        _tag: "success",
      },
    });
  });
}

function ensureProducerStarted(generation: ActiveChatGeneration) {
  return SynchronizedRef.modifyEffect(
    generation.producerFiberRef,
    (currentFiber) => {
      if (currentFiber) {
        return Effect.succeed([currentFiber, currentFiber] as const);
      }

      return generation.startProducer().pipe(
        Effect.map((fiber) => [fiber, fiber] as const),
      );
    },
  );
}

function detachSubscriber(input: {
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>;
  generation: ActiveChatGeneration;
}) {
  return Effect.gen(function* () {
    const nextCount = yield* Ref.updateAndGet(
      input.generation.subscriberCount,
      (count) => Math.max(0, count - 1),
    );
    if (nextCount > 0) {
      return;
    }

    const terminalEvent = yield* Ref.get(input.generation.terminalEventRef);
    if (terminalEvent) {
      return;
    }

    yield* abortGeneration(input);
  });
}

function attachGenerationStream(input: {
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>;
  generation: ActiveChatGeneration;
}) {
  return Stream.unwrapScoped(
    Effect.gen(function* () {
      yield* Ref.update(input.generation.subscriberCount, (count) => count + 1);
      yield* Effect.addFinalizer(() => detachSubscriber(input));

      const source = yield* Stream.fromPubSub(input.generation.events, {
        scoped: true,
      });

      yield* ensureProducerStarted(input.generation);

      const terminalEvent = yield* Ref.get(input.generation.terminalEventRef);
      if (terminalEvent) {
        return eventToStream(terminalEvent);
      }

      return source.pipe(
        Stream.takeUntil((event) => event._tag !== "chunk"),
        Stream.flatMap(eventToStream),
      );
    }),
  );
}

function produceGeneration(input: {
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>;
  generation: ActiveChatGeneration;
  stream: ReadableStream<UIMessageChunk>;
  providerID: string;
}) {
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(
      readableStreamToEffectStream({
        stream: input.stream,
        map: (chunk) =>
          Effect.try({
            try: () => toOpaqueJsonObject(chunk, "chat stream chunk"),
            catch: (error) => error,
          }).pipe(
            Effect.flatMap((encodedChunk) =>
              publishChunkEvent(input.generation, encodedChunk),
            ),
          ),
        mapError: (error) => error,
      }).pipe(
        Stream.runDrain,
      ),
    );

    if (Exit.isSuccess(exit)) {
      yield* finishGeneration({
        registryRef: input.registryRef,
        generation: input.generation,
        event: {
          _tag: "success",
        },
      });
      return;
    }

    if (
      input.generation.abortController.signal.aborted ||
      Cause.isInterruptedOnly(exit.cause)
    ) {
      yield* finishGeneration({
        registryRef: input.registryRef,
        generation: input.generation,
        event: {
          _tag: "success",
        },
      });
      return;
    }

    const failure = Cause.failureOption(exit.cause);
    const normalizedError = Option.isSome(failure)
      ? normalizeChatStreamFailure({
          error: failure.value,
          providerID: input.providerID,
        })
      : wrapExtensionError(Cause.pretty(exit.cause), "chat.stream");

    if (normalizedError instanceof Error) {
      logChatError("stream.failed", normalizedError, {
        chatId: input.generation.chatId,
        providerId: input.providerID,
      });
    }

    yield* finishGeneration({
      registryRef: input.registryRef,
      generation: input.generation,
      event: {
        _tag: "failure",
        error: normalizedError,
      },
    });
  });
}

function makeChatExecutionService(input: {
  deps: ChatExecutionServiceDeps;
  registryRef: SynchronizedRef.SynchronizedRef<Map<string, ActiveChatGeneration>>;
  producerFibers: FiberSet.FiberSet<void, never>;
}): ChatExecutionServiceApi {
  const sendMessages = (request: RuntimeChatSendMessagesInput) =>
    Effect.gen(function* () {
      const generationKey = toGenerationKey(request);
      const abortController = new AbortController();
      const requestID = nextChatRequestId();
      const sessionID = request.chatId;
      const prepared = yield* prepareChatGeneration({
        deps: input.deps,
        request,
        abortController,
        requestID,
        sessionID,
      });
      const generation = yield* makeGenerationState({
        generationKey,
        origin: request.origin,
        chatId: request.chatId,
        abortController,
        registryRef: input.registryRef,
        producerFibers: input.producerFibers,
        prepared,
      });

      const existing = yield* replaceGeneration(input.registryRef, generation);
      if (existing) {
        yield* abortGeneration({
          registryRef: input.registryRef,
          generation: existing,
        });
      }

      logChatDebug("send.started", {
        chatId: request.chatId,
        modelId: request.modelId,
        requestID,
        messageCount: request.messages.length,
        hasOptions: request.options != null,
      });

      return attachGenerationStream({
        registryRef: input.registryRef,
        generation,
      });
    });

  const reconnectStream = (request: RuntimeChatReconnectStreamInput) =>
    Effect.gen(function* () {
      const generation = yield* getGeneration(
        input.registryRef,
        toGenerationKey(request),
      ).pipe(
        Effect.mapError(() => toChatStreamNotFoundError(request)),
      );

      return attachGenerationStream({
        registryRef: input.registryRef,
        generation,
      });
    });

  const abortStream = (request: RuntimeAbortChatStreamInput) =>
    Effect.gen(function* () {
      const generation = yield* takeGeneration(
        input.registryRef,
        toGenerationKey(request),
      );
      if (!generation) {
        return;
      }

      yield* abortGeneration({
        registryRef: input.registryRef,
        generation,
      });
    });

  return {
    sendMessages,
    reconnectStream,
    abortStream,
  };
}

export const ChatExecutionServiceLive = Layer.scoped(
  ChatExecutionService,
  Effect.gen(function* () {
    const registryRef =
      yield* SynchronizedRef.make<Map<string, ActiveChatGeneration>>(new Map());
    const producerFibers = yield* FiberSet.make<void, never>();

    return makeChatExecutionService({
      deps: {
        prepareLanguageModelCall: prepareRuntimeChatModelCall,
        convertMessages: convertToModelMessages,
        validateMessages: validateUIMessages,
        streamTextImpl: streamText,
      },
      registryRef,
      producerFibers,
    });
  }),
);
