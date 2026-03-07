import {
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type ChatTransport,
  type UIMessage,
} from "ai";

type AppMessage = UIMessage;
type AppModel = Parameters<typeof streamText>[0]["model"];

export interface BridgeChatTransportOptions {
  getSelectedModelId: () => string;
  loadModel: (modelId: string) => Promise<AppModel>;
  pushDebug: (event: string, details?: unknown) => void;
}

function getModelDebugDetails(model: AppModel) {
  if (!model || typeof model !== "object") {
    return {};
  }

  return {
    provider:
      "provider" in model && typeof model.provider === "string"
        ? model.provider
        : undefined,
    modelId:
      "modelId" in model && typeof model.modelId === "string"
        ? model.modelId
        : undefined,
  };
}

function getLatestUserText(messages: AppMessage[]) {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    return "";
  }

  return latestUserMessage.parts
    .filter((part): part is Extract<(typeof latestUserMessage.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function createBridgeChatTransport({
  getSelectedModelId,
  loadModel,
  pushDebug,
}: BridgeChatTransportOptions): ChatTransport<AppMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      const selectedModelId = getSelectedModelId();
      if (!selectedModelId) {
        throw new Error("No model selected.");
      }

      const validatedMessages = await validateUIMessages({ messages });
      const modelMessages = await convertToModelMessages(validatedMessages);
      const prompt = getLatestUserText(validatedMessages);

      pushDebug("stream.started", {
        selectedModelId,
        promptLength: prompt.length,
        messageCount: validatedMessages.length,
      });

      const model = await loadModel(selectedModelId);
      pushDebug("stream.modelLoaded", {
        selectedModelId,
        ...getModelDebugDetails(model),
      });

      const result = streamText({
        model,
        messages: modelMessages,
        abortSignal,
        providerOptions: {
          openai: { instructions: "You are a helpful assistant" },
        },
      });

      return result.toUIMessageStream({
        originalMessages: validatedMessages,
      });
    },
    async reconnectToStream() {
      return null;
    },
  };
}
