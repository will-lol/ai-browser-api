import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  RuntimeAbortChatStreamInputSchema,
  RuntimeAbortModelCallInputSchema,
  RuntimeAcquireModelInputSchema,
  RuntimeChatReconnectStreamInputSchema,
  RuntimeChatSendMessagesInputSchema,
  RuntimeChatStreamChunkSchema,
  RuntimeGenerateResponseSchema,
  RuntimeModelCallInputSchema,
  RuntimeModelDescriptorSchema,
  RuntimeStreamPartSchema,
} from "./entities";
import { RuntimeRpcErrorSchema } from "./errors";

export const RuntimeAcquireModelRpc = Rpc.make("acquireModel", {
  payload: RuntimeAcquireModelInputSchema,
  success: RuntimeModelDescriptorSchema,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeModelDoGenerateRpc = Rpc.make("modelDoGenerate", {
  payload: RuntimeModelCallInputSchema,
  success: RuntimeGenerateResponseSchema,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeModelDoStreamRpc = Rpc.make("modelDoStream", {
  payload: RuntimeModelCallInputSchema,
  success: RuntimeStreamPartSchema,
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeAbortModelCallRpc = Rpc.make("abortModelCall", {
  payload: RuntimeAbortModelCallInputSchema,
  success: Schema.Void,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeChatSendMessagesRpc = Rpc.make("chatSendMessages", {
  payload: RuntimeChatSendMessagesInputSchema,
  success: RuntimeChatStreamChunkSchema,
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeChatReconnectStreamRpc = Rpc.make("chatReconnectStream", {
  payload: RuntimeChatReconnectStreamInputSchema,
  success: RuntimeChatStreamChunkSchema,
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeAbortChatStreamRpc = Rpc.make("abortChatStream", {
  payload: RuntimeAbortChatStreamInputSchema,
  success: Schema.Void,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeExecutionRpcGroup = RpcGroup.make(
  RuntimeAcquireModelRpc,
  RuntimeModelDoGenerateRpc,
  RuntimeModelDoStreamRpc,
  RuntimeAbortModelCallRpc,
  RuntimeChatSendMessagesRpc,
  RuntimeChatReconnectStreamRpc,
  RuntimeAbortChatStreamRpc,
);
