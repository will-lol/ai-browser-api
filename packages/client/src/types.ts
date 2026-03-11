import type { UIMessage } from "ai";

export type BridgeWireValue =
  | null
  | string
  | number
  | boolean
  | ReadonlyArray<BridgeWireValue>
  | { readonly [key: string]: BridgeWireValue };

type BridgeJsonValue =
  | null
  | string
  | number
  | boolean
  | ReadonlyArray<BridgeJsonValue>
  | { readonly [key: string]: BridgeJsonValue };

export type BridgeProviderOptions = Record<
  string,
  Record<string, BridgeJsonValue>
>;

export type BridgeTool =
  | {
      type: "function";
      name: string;
      description?: string;
      inputSchema: BridgeWireValue;
      inputExamples?: ReadonlyArray<{
        input: Record<string, BridgeJsonValue>;
      }>;
      strict?: boolean;
      providerOptions?: BridgeProviderOptions;
    }
  | {
      type: "provider";
      id: string;
      name: string;
      args: Record<string, BridgeWireValue>;
    };

export type BridgeToolChoice =
  | {
      type: "auto" | "none" | "required";
    }
  | {
      type: "tool";
      toolName: string;
    };

export type BridgeResponseFormat =
  | {
      type: "text";
    }
  | {
      type: "json";
      schema?: BridgeWireValue;
      name?: string;
      description?: string;
    };

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
  ) => BridgeChatCallOptions | Promise<BridgeChatCallOptions>;
};

export type BridgeModelSummary = {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly connected: boolean;
};

export type BridgePendingRequest = {
  readonly modelId: string;
  readonly origin: string;
  readonly id: string;
  readonly provider: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly modelName: string;
  readonly requestedAt: number;
  readonly dismissed: boolean;
  readonly status: "pending" | "resolved";
};

export type BridgePermissionRequest = {
  modelId: string;
};

export type BridgePermissionResult =
  | {
      readonly status: "alreadyAllowed";
    }
  | {
      readonly status: "requested";
      readonly request: BridgePendingRequest;
    };

export type BridgeChatCallOptions = {
  system?: string;
  maxOutputTokens?: number;
  temperature?: number;
  stopSequences?: ReadonlyArray<string>;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  responseFormat?: BridgeResponseFormat;
  seed?: number;
  tools?: ReadonlyArray<BridgeTool>;
  toolChoice?: BridgeToolChoice;
  includeRawChunks?: boolean;
  headers?: Readonly<Record<string, string>>;
  providerOptions?: BridgeProviderOptions;
};
