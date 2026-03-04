import * as Rpc from "@effect/rpc/Rpc"
import * as RpcGroup from "@effect/rpc/RpcGroup"
import * as Schema from "effect/Schema"
import {
  BridgeAbortRequestSchema,
  BridgeListModelsResponseSchema,
  BridgeModelCallRequestSchema,
  BridgeModelDescriptorResponseSchema,
  BridgeModelRequestSchema,
  BridgePermissionRequestSchema,
  BridgeStateResponseSchema,
  RuntimeCreatePermissionRequestResponseSchema,
  RuntimeDismissPermissionRequestResponseSchema,
  RuntimeGenerateResponseSchema,
  RuntimeResolvePermissionRequestResponseSchema,
  RuntimeStreamPartSchema,
} from "./entities"
import { RuntimeRpcErrorSchema } from "./errors"

export const PAGE_BRIDGE_READY_EVENT = "llm-bridge-ready"
export const PAGE_BRIDGE_INIT_MESSAGE = "llm-bridge-init-v2"

export const PageBridgeRpcGroup = RpcGroup.make(
  Rpc.make("getState", {
    payload: {},
    success: BridgeStateResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
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
    success: Schema.Union(
      RuntimeCreatePermissionRequestResponseSchema,
      RuntimeResolvePermissionRequestResponseSchema,
      RuntimeDismissPermissionRequestResponseSchema,
    ),
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
)

export type PageBridgeRpc = RpcGroup.Rpcs<typeof PageBridgeRpcGroup>
