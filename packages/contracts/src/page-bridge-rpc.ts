import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  BridgeChatSendMessagesRequestSchema,
  BridgeModelDescriptorResponseSchema,
  BridgePermissionRequestSchema,
  RuntimeAbortChatStreamInputSchema,
  RuntimeAbortModelCallInputSchema,
  RuntimeAcquireModelInputSchema,
  RuntimeChatReconnectStreamInputSchema,
  RuntimeChatStreamChunkSchema,
  RuntimeGenerateResponseSchema,
  RuntimeModelCallInputSchema,
  RuntimeModelSummarySchema,
  RuntimeOriginStateSchema,
  RuntimePendingRequestSchema,
  RuntimeStreamPartSchema,
} from "./entities";
import { RuntimeRpcErrorSchema } from "./errors";

export const PageBridgeListModelsPayloadSchema = Schema.Struct({
  connectedOnly: Schema.optional(Schema.Boolean),
  providerID: Schema.optional(Schema.String),
});

const PageBridgeEmptyPayloadSchema = Schema.Struct({});

export const PageBridgeListModelsRpc = Rpc.make("listModels", {
  payload: PageBridgeListModelsPayloadSchema,
  success: Schema.Array(RuntimeModelSummarySchema),
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeStreamModelsRpc = Rpc.make("streamModels", {
  payload: PageBridgeListModelsPayloadSchema,
  success: Schema.Array(RuntimeModelSummarySchema),
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeGetOriginStateRpc = Rpc.make("getOriginState", {
  payload: PageBridgeEmptyPayloadSchema,
  success: RuntimeOriginStateSchema,
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeListPendingRpc = Rpc.make("listPending", {
  payload: PageBridgeEmptyPayloadSchema,
  success: Schema.Array(RuntimePendingRequestSchema),
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeAcquireModelRpc = Rpc.make("acquireModel", {
  payload: Schema.Struct({
    requestId: RuntimeAcquireModelInputSchema.fields.requestId,
    sessionID: RuntimeAcquireModelInputSchema.fields.sessionID,
    modelId: RuntimeAcquireModelInputSchema.fields.modelId,
  }),
  success: BridgeModelDescriptorResponseSchema,
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeModelDoGenerateRpc = Rpc.make("modelDoGenerate", {
  payload: Schema.Struct({
    requestId: RuntimeModelCallInputSchema.fields.requestId,
    sessionID: RuntimeModelCallInputSchema.fields.sessionID,
    modelId: RuntimeModelCallInputSchema.fields.modelId,
    options: RuntimeModelCallInputSchema.fields.options,
  }),
  success: RuntimeGenerateResponseSchema,
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeModelDoStreamRpc = Rpc.make("modelDoStream", {
  payload: Schema.Struct({
    requestId: RuntimeModelCallInputSchema.fields.requestId,
    sessionID: RuntimeModelCallInputSchema.fields.sessionID,
    modelId: RuntimeModelCallInputSchema.fields.modelId,
    options: RuntimeModelCallInputSchema.fields.options,
  }),
  success: RuntimeStreamPartSchema,
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeAbortModelCallRpc = Rpc.make("abortModelCall", {
  payload: Schema.Struct({
    requestId: RuntimeAbortModelCallInputSchema.fields.requestId,
    sessionID: RuntimeAbortModelCallInputSchema.fields.sessionID,
  }),
  success: Schema.Void,
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeChatSendMessagesRpc = Rpc.make("chatSendMessages", {
  payload: BridgeChatSendMessagesRequestSchema,
  success: RuntimeChatStreamChunkSchema,
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeChatReconnectStreamRpc = Rpc.make(
  "chatReconnectStream",
  {
    payload: Schema.Struct({
      chatId: RuntimeChatReconnectStreamInputSchema.fields.chatId,
    }),
    success: RuntimeChatStreamChunkSchema,
    stream: true,
    error: RuntimeRpcErrorSchema,
  },
);

export const PageBridgeAbortChatStreamRpc = Rpc.make("abortChatStream", {
  payload: Schema.Struct({
    chatId: RuntimeAbortChatStreamInputSchema.fields.chatId,
  }),
  success: Schema.Void,
  error: RuntimeRpcErrorSchema,
});

export const PageBridgeCreatePermissionRequestRpc = Rpc.make(
  "createPermissionRequest",
  {
    payload: BridgePermissionRequestSchema,
    success: Schema.Union(
      Schema.Struct({
        status: Schema.Literal("alreadyAllowed"),
      }),
      Schema.Struct({
        status: Schema.Literal("requested"),
        request: RuntimePendingRequestSchema,
      }),
    ),
    error: RuntimeRpcErrorSchema,
  },
);

export const PageBridgeRpcGroup = RpcGroup.make(
  PageBridgeListModelsRpc,
  PageBridgeStreamModelsRpc,
  PageBridgeGetOriginStateRpc,
  PageBridgeListPendingRpc,
  PageBridgeAcquireModelRpc,
  PageBridgeModelDoGenerateRpc,
  PageBridgeModelDoStreamRpc,
  PageBridgeAbortModelCallRpc,
  PageBridgeChatSendMessagesRpc,
  PageBridgeChatReconnectStreamRpc,
  PageBridgeAbortChatStreamRpc,
  PageBridgeCreatePermissionRequestRpc,
);

export type PageBridgeRpc = RpcGroup.Rpcs<typeof PageBridgeRpcGroup>;

export const PAGE_BRIDGE_READY_EVENT = "llm-bridge-ready";
export const PAGE_BRIDGE_INIT_MESSAGE = "llm-bridge-init-v2";
export const PAGE_BRIDGE_PORT_CONTROL_MESSAGE = "llm-bridge-port-control-v1";

export type PageBridgePortControlMessage = {
  readonly _tag: typeof PAGE_BRIDGE_PORT_CONTROL_MESSAGE;
  readonly type: "disconnect";
  readonly reason?: string;
  readonly connectionId?: number;
};

export function isPageBridgePortControlMessage(
  value: unknown,
): value is PageBridgePortControlMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    record._tag !== PAGE_BRIDGE_PORT_CONTROL_MESSAGE ||
    record.type !== "disconnect"
  ) {
    return false;
  }

  if (
    "reason" in record &&
    record.reason !== undefined &&
    typeof record.reason !== "string"
  ) {
    return false;
  }

  if (
    "connectionId" in record &&
    record.connectionId !== undefined &&
    typeof record.connectionId !== "number"
  ) {
    return false;
  }

  return true;
}
