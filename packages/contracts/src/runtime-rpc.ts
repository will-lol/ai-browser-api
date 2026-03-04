import * as Rpc from "@effect/rpc/Rpc"
import * as RpcGroup from "@effect/rpc/RpcGroup"
import * as Schema from "effect/Schema"
import {
  RuntimeAbortModelCallInputSchema,
  RuntimeAcquireModelInputSchema,
  RuntimeAuthFlowSnapshotSchema,
  RuntimeCancelProviderAuthFlowResponseSchema,
  RuntimeCreatePermissionRequestResponseSchema,
  RuntimeDismissPermissionRequestResponseSchema,
  RuntimeDisconnectProviderResponseSchema,
  RuntimeGenerateResponseSchema,
  RuntimeModelCallInputSchema,
  RuntimeModelDescriptorSchema,
  RuntimeModelSummarySchema,
  RuntimeOpenProviderAuthWindowResponseSchema,
  RuntimeOriginStateSchema,
  RuntimePendingRequestSchema,
  RuntimePermissionEntrySchema,
  RuntimeProviderSummarySchema,
  RuntimeRequestPermissionInputSchema,
  RuntimeResolvePermissionRequestResponseSchema,
  RuntimeSetOriginEnabledResponseSchema,
  RuntimeStartProviderAuthFlowResponseSchema,
  RuntimeStreamPartSchema,
  RuntimeUpdatePermissionInputSchema,
  RuntimeUpdatePermissionResponseSchema,
} from "./entities"
import { RuntimeRpcErrorSchema } from "./errors"

export const RUNTIME_RPC_PORT_NAME = "llm-bridge-runtime-rpc-v2"

export const RuntimeRpcGroup = RpcGroup.make(
  Rpc.make("listProviders", {
    payload: {
      origin: Schema.String,
    },
    success: Schema.Array(RuntimeProviderSummarySchema),
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("listModels", {
    payload: {
      origin: Schema.String,
      connectedOnly: Schema.optional(Schema.Boolean),
      providerID: Schema.optional(Schema.String),
    },
    success: Schema.Array(RuntimeModelSummarySchema),
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("listConnectedModels", {
    payload: {
      origin: Schema.String,
    },
    success: Schema.Array(RuntimeModelSummarySchema),
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("getOriginState", {
    payload: {
      origin: Schema.String,
    },
    success: RuntimeOriginStateSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("listPermissions", {
    payload: {
      origin: Schema.String,
    },
    success: Schema.Array(RuntimePermissionEntrySchema),
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("listPending", {
    payload: {
      origin: Schema.String,
    },
    success: Schema.Array(RuntimePendingRequestSchema),
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("openProviderAuthWindow", {
    payload: {
      origin: Schema.String,
      providerID: Schema.String,
    },
    success: RuntimeOpenProviderAuthWindowResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("getProviderAuthFlow", {
    payload: {
      origin: Schema.String,
      providerID: Schema.String,
    },
    success: Schema.Struct({
      providerID: Schema.String,
      result: RuntimeAuthFlowSnapshotSchema,
    }),
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("startProviderAuthFlow", {
    payload: {
      origin: Schema.String,
      providerID: Schema.String,
      methodID: Schema.String,
      values: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
    },
    success: RuntimeStartProviderAuthFlowResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("cancelProviderAuthFlow", {
    payload: {
      origin: Schema.String,
      providerID: Schema.String,
      reason: Schema.optional(Schema.String),
    },
    success: RuntimeCancelProviderAuthFlowResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("disconnectProvider", {
    payload: {
      origin: Schema.String,
      providerID: Schema.String,
    },
    success: RuntimeDisconnectProviderResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("updatePermission", {
    payload: RuntimeUpdatePermissionInputSchema,
    success: Schema.Union(RuntimeSetOriginEnabledResponseSchema, RuntimeUpdatePermissionResponseSchema),
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("requestPermission", {
    payload: RuntimeRequestPermissionInputSchema,
    success: Schema.Union(
      RuntimeCreatePermissionRequestResponseSchema,
      RuntimeDismissPermissionRequestResponseSchema,
      RuntimeResolvePermissionRequestResponseSchema,
    ),
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("acquireModel", {
    payload: RuntimeAcquireModelInputSchema,
    success: RuntimeModelDescriptorSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("modelDoGenerate", {
    payload: RuntimeModelCallInputSchema,
    success: RuntimeGenerateResponseSchema,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("modelDoStream", {
    payload: RuntimeModelCallInputSchema,
    success: RuntimeStreamPartSchema,
    stream: true,
    error: RuntimeRpcErrorSchema,
  }),
  Rpc.make("abortModelCall", {
    payload: RuntimeAbortModelCallInputSchema,
    success: Schema.Void,
    error: RuntimeRpcErrorSchema,
  }),
)

export type RuntimeRpc = RpcGroup.Rpcs<typeof RuntimeRpcGroup>
