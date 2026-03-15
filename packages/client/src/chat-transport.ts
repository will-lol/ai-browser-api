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
import type { BridgeConnection } from "./connection";
import {
  attachAbortEffect,
  createReadableStreamFromReader,
  effectStreamToReadableStream,
  probeReadableStream,
} from "./transport-boundary";
import {
  createMissingChatModelIdError,
  createUnsupportedChatTransportHeadersError,
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
  abortChatStream: (chatId: string) => Effect.Effect<void, unknown>;
}): ReadableStream<UIMessageChunk> {
  const cleanup = attachAbortEffect({
    signal: input.abortSignal,
    effect: input.abortChatStream(input.chatId),
    onError: () => undefined,
  });

  return createReadableStreamFromReader({
    reader: input.reader,
    map: (value) => value as UIMessageChunk,
    cleanup,
    onReadError: (error) =>
      toBridgeDefect(
        error instanceof Error ? error : new Error(String(error)),
      ),
  });
}

export function createChatTransport(input: {
  ensureConnection: Effect.Effect<
    BridgeConnection,
    import("@llm-bridge/contracts").RuntimeRpcError
  >;
  abortChatStream: (chatId: string) => Effect.Effect<void, unknown>;
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

      const runtimeStream = await effectStreamToReadableStream(
        Effect.gen(function* () {
          const current = yield* input.ensureConnection;
          return current.client.chatSendMessages({
            chatId,
            modelId,
            trigger,
            messageId,
            messages: validatedMessages.map((message: UIMessage) =>
              toOpaqueJsonObject(message, "chat message"),
            ),
            options: runtimeOptions,
          });
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
        const runtimeStream = await effectStreamToReadableStream(
          Effect.gen(function* () {
            const current = yield* input.ensureConnection;
            return current.client.chatReconnectStream({
              chatId,
            });
          }),
        );

        const reconnectStream = await probeReadableStream(runtimeStream);

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
