import {
  RuntimeChatStreamNotFoundError,
  type JsonValue,
} from "@llm-bridge/contracts";
import {
  validateUIMessages,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { BridgeConnection } from "./connection";
import {
  createMissingChatModelIdError,
  createUnsupportedChatTransportHeadersError,
  currentOrigin,
  hasRequestHeaders,
  isObjectRecord,
  toBridgeDefect,
  toOpaqueJsonObject,
} from "./shared";
import type { BridgeChatTransportOptions } from "./types";

function resolveChatRequestModelId(input: { body: object | undefined }): {
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
      Object.keys(bodyWithoutModelId).length > 0
        ? bodyWithoutModelId
        : undefined,
  };
}

function createChatReadableStream(input: {
  chatId: string;
  reader: ReadableStreamDefaultReader<{ readonly [key: string]: JsonValue }>;
  abortSignal?: AbortSignal;
  abortChatStream: (chatId: string) => Promise<void>;
}): ReadableStream<UIMessageChunk> {
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
        const next = await input.reader.read();
        if (next.done) {
          cleanup();
          controller.close();
          return;
        }

        controller.enqueue(next.value as UIMessageChunk);
      } catch (error) {
        cleanup();
        throw toBridgeDefect(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
    async cancel() {
      try {
        await input.reader.cancel();
      } finally {
        cleanup();
      }
    },
  });
}

async function prepareReconnectReadableStream(
  stream: ReadableStream<{ readonly [key: string]: JsonValue }>,
) {
  const [probeStream, consumerStream] = stream.tee();
  const reader = probeStream.getReader();

  try {
    await reader.read();
    return consumerStream;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function createChatTransport(input: {
  ensureConnection: Effect.Effect<
    BridgeConnection,
    import("@llm-bridge/contracts").RuntimeRpcError
  >;
  abortChatStream: (chatId: string) => Promise<void>;
  options?: BridgeChatTransportOptions;
}): ChatTransport<UIMessage> {
  return {
    async sendMessages({
      chatId,
      trigger,
      messageId,
      messages,
      abortSignal,
      headers,
      body,
      metadata,
    }) {
      if (hasRequestHeaders(headers)) {
        throw createUnsupportedChatTransportHeadersError();
      }

      const validatedMessages = await validateUIMessages({
        messages,
      });

      const { modelId, bodyWithoutModelId } = resolveChatRequestModelId({
        body,
      });

      const runtimeOptions = input.options?.prepareSendMessages
        ? await input.options.prepareSendMessages({
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
                origin: currentOrigin(),
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
    async reconnectToStream({ chatId, headers }) {
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
                  origin: currentOrigin(),
                  chatId,
                }),
              ),
            );
          }),
        );

        const reconnectStream =
          await prepareReconnectReadableStream(runtimeStream);

        return createChatReadableStream({
          chatId,
          reader: reconnectStream.getReader(),
          abortChatStream: input.abortChatStream,
        });
      } catch (error) {
        if (error instanceof RuntimeChatStreamNotFoundError) {
          return null;
        }

        throw error;
      }
    },
  };
}
