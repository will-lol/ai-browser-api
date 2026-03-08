import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  BridgeAbortChatStreamRequestSchema,
  BridgeAbortRequestSchema,
  BridgeChatReconnectStreamRequestSchema,
  BridgeChatSendMessagesRequestSchema,
  BridgeListModelsResponseSchema,
  BridgeModelCallRequestSchema,
  BridgeModelDescriptorResponseSchema,
  BridgeModelRequestSchema,
  BridgePermissionRequestSchema,
  RuntimeCreatePermissionRequestResponseSchema,
  RuntimeChatStreamChunkSchema,
  RuntimeGenerateResponseSchema,
  RuntimeStreamPartSchema,
} from "./entities";
import { RuntimeRpcErrorSchema } from "./errors";

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

export const PageBridgeRpcGroup = RpcGroup.make(
  Rpc.make("listModels", {
    payload: {},
    success: BridgeListModelsResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("getModel", {
    payload: BridgeModelRequestSchema,
    success: BridgeModelDescriptorResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("requestPermission", {
    payload: BridgePermissionRequestSchema,
    success: RuntimeCreatePermissionRequestResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("abort", {
    payload: BridgeAbortRequestSchema,
    success: Schema.Struct({
      ok: Schema.Boolean,
    }),
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("modelDoGenerate", {
    payload: BridgeModelCallRequestSchema,
    success: RuntimeGenerateResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("modelDoStream", {
    payload: BridgeModelCallRequestSchema,
    success: RuntimeStreamPartSchema,
    stream: true,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("chatSendMessages", {
    payload: BridgeChatSendMessagesRequestSchema,
    success: RuntimeChatStreamChunkSchema,
    stream: true,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("chatReconnectStream", {
    payload: BridgeChatReconnectStreamRequestSchema,
    success: RuntimeChatStreamChunkSchema,
    stream: true,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("abortChatStream", {
    payload: BridgeAbortChatStreamRequestSchema,
    success: Schema.Struct({
      ok: Schema.Boolean,
    }),
    error: RuntimeRpcErrorSchema,
  }),
);

export type PageBridgeRpc = RpcGroup.Rpcs<typeof PageBridgeRpcGroup>;
