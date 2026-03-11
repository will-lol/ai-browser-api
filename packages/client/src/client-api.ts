import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
  BridgeModelDescriptorResponse,
  RuntimeRpcError,
} from "@llm-bridge/contracts";
import type { ChatTransport, UIMessage } from "ai";
import * as Effect from "effect/Effect";
import type { BridgeConnection } from "./connection";
import { createChatTransport } from "./chat-transport";
import { currentOrigin } from "./shared";
import type {
  BridgeChatTransportOptions,
  BridgePermissionRequest,
} from "./types";

export function makeBridgeClientApi(input: {
  ensureConnection: Effect.Effect<BridgeConnection, RuntimeRpcError>;
  destroy: Effect.Effect<void, never>;
  abortChatStream: (chatId: string) => Promise<void>;
  createLanguageModel: (
    modelId: string,
    descriptor: BridgeModelDescriptorResponse,
  ) => LanguageModelV3;
  nextModelRequestId: () => string;
}) {
  const listModels = () =>
    Effect.runPromise(
      input.ensureConnection.pipe(
        Effect.flatMap((current) =>
          current.client.listModels({
            origin: currentOrigin(),
            connectedOnly: true,
          }),
        ),
      ),
    );

  const requestPermission = (payload: BridgePermissionRequest) =>
    Effect.runPromise(
      input.ensureConnection.pipe(
        Effect.flatMap((current) =>
          current.client.createPermissionRequest({
            origin: currentOrigin(),
            modelId: payload.modelId,
          }),
        ),
      ),
    );

  const getModel = (modelId: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const requestId = input.nextModelRequestId();
        const current = yield* input.ensureConnection;
        const descriptor = yield* current.client.acquireModel({
          origin: currentOrigin(),
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
    getModel,
    getChatTransport,
    requestPermission,
    close: () => Effect.runPromise(input.destroy),
  };
}

export type BridgeClientApi = ReturnType<typeof makeBridgeClientApi>;
