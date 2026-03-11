import type { BridgeClientApi, BridgeModelSummary } from "@llm-bridge/client";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
  BridgeChatTransportOptions,
  BridgePermissionResult,
} from "@llm-bridge/client";
import type { ChatTransport, UIMessage } from "ai";

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
  refresh: () => Promise<void>;
};

export type BridgeModelState = BridgeQueryState<LanguageModelV3> & {
  model: LanguageModelV3 | null;
  refresh: () => Promise<void>;
};

export type BridgeChatTransportState = BridgeConnectionState & {
  transport: ChatTransport<UIMessage>;
  options: BridgeChatTransportOptions | undefined;
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
