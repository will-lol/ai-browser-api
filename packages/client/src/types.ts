import type {
  RuntimeChatCallOptions,
  RuntimeCreatePermissionRequestResponse,
  RuntimeModelSummary,
} from "@llm-bridge/contracts";
import type { UIMessage } from "ai";

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
