import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
  BridgeModelDescriptorResponse,
  RuntimeRpcError,
} from "@llm-bridge/contracts";
import type { ChatTransport, UIMessage } from "ai";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { BridgeConnection } from "./connection";
import { createChatTransport } from "./chat-transport";
import { runClientTransport } from "./transport-boundary";
import type {
  BridgeChatTransportOptions,
  BridgePermissionRequest,
} from "./types";

export function makeBridgeClientApi(input: {
  ensureConnection: Effect.Effect<BridgeConnection, RuntimeRpcError>;
  destroy: Effect.Effect<void, never>;
  abortChatStream: (chatId: string) => Effect.Effect<void, RuntimeRpcError>;
  createLanguageModel: (
    modelId: string,
    descriptor: BridgeModelDescriptorResponse,
  ) => LanguageModelV3;
  nextModelRequestId: () => string;
}) {
  const listModels = () =>
    runClientTransport(
      input.ensureConnection.pipe(
        Effect.flatMap((current) =>
          current.client.listModels({
            connectedOnly: true,
          }),
        ),
      ),
    );

  const streamModels = () =>
    Stream.unwrap(
      input.ensureConnection.pipe(
        Effect.map((current) =>
          current.client.streamModels({
            connectedOnly: true,
          }),
        ),
      ),
    );

  const requestPermission = (payload: BridgePermissionRequest) =>
    runClientTransport(
      input.ensureConnection.pipe(
        Effect.flatMap((current) =>
          current.client.createPermissionRequest({
            modelId: payload.modelId,
          }),
        ),
      ),
    );

  const getModel = (modelId: string) =>
    runClientTransport(
      Effect.gen(function* () {
        const requestId = input.nextModelRequestId();
        const current = yield* input.ensureConnection;
        const descriptor = yield* current.client.acquireModel({
          requestId,
          sessionID: requestId,
          modelId,
        });

        return input.createLanguageModel(modelId, descriptor);
      }),
    );

  const getChatTransport = (
    options: BridgeChatTransportOptions = {},
  ): ChatTransport<UIMessage> =>
    createChatTransport({
      ensureConnection: input.ensureConnection,
      abortChatStream: input.abortChatStream,
      options,
    });

  return {
    listModels,
    streamModels,
    getModel,
    getChatTransport,
    requestPermission,
    close: () => runClientTransport(input.destroy),
  };
}

export type BridgeClientApi = ReturnType<typeof makeBridgeClientApi>;
