import type {
  UseChatHelpers as AiUseChatHelpers,
  UseChatOptions as AiUseChatOptions,
} from "@ai-sdk/react";
import type { BridgeClientApi, BridgeModelSummary } from "@llm-bridge/client";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
  BridgeChatTransportOptions,
  BridgePermissionResult,
} from "@llm-bridge/client";
import type { ChatInit, UIMessage } from "ai";

export type BridgeConnectionStatus = "loading" | "ready" | "error";

export type BridgeConnectionState = {
  status: BridgeConnectionStatus;
  error: Error | null;
  client: BridgeClientApi | null;
  isLoading: boolean;
  isReady: boolean;
  hasError: boolean;
};

export type BridgeQueryState<Value> = {
  status: BridgeConnectionStatus;
  error: Error | null;
  value: Value | null;
  isLoading: boolean;
  isReady: boolean;
  hasError: boolean;
};

export type BridgeModelsState = BridgeQueryState<
  ReadonlyArray<BridgeModelSummary>
> & {
  models: ReadonlyArray<BridgeModelSummary>;
};

export type BridgeModelState = BridgeQueryState<LanguageModelV3> & {
  model: LanguageModelV3 | null;
  refresh: () => Promise<void>;
};

export type UseChatOptions<UI_MESSAGE extends UIMessage = UIMessage> = Omit<
  ChatInit<UI_MESSAGE>,
  "transport"
> & {
  experimental_throttle?: AiUseChatOptions<UI_MESSAGE>["experimental_throttle"];
  resume?: AiUseChatOptions<UI_MESSAGE>["resume"];
  transportOptions?: BridgeChatTransportOptions;
};

export type UseChatHelpers<UI_MESSAGE extends UIMessage = UIMessage> =
  AiUseChatHelpers<UI_MESSAGE> & {
    isReady: boolean;
    isLoading: boolean;
    hasError: boolean;
    transportError: Error | null;
  };

export type BridgePermissionRequestInput = Parameters<
  BridgeClientApi["requestPermission"]
>[0];

export type BridgePermissionRequestState = {
  requestPermission: (
    input: BridgePermissionRequestInput,
  ) => Promise<BridgePermissionResult>;
  error: Error | null;
  isPending: boolean;
  reset: () => void;
};
