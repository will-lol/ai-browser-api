import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  RuntimeAbortModelCallInputSchema,
  RuntimeAcquireModelInputSchema,
  RuntimeAuthFlowSnapshotSchema,
  RuntimeCancelProviderAuthFlowResponseSchema,
  RuntimeCreatePermissionRequestInputSchema,
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
} from "./entities";
import { RuntimeRpcErrorSchema } from "./errors";

export const RUNTIME_PUBLIC_RPC_PORT_NAME = "llm-bridge-runtime-public-rpc-v1";
export const RUNTIME_ADMIN_RPC_PORT_NAME = "llm-bridge-runtime-admin-rpc-v1";

// Backward compatibility for callers that have not switched to explicit role-based clients.
export const RUNTIME_RPC_PORT_NAME = RUNTIME_ADMIN_RPC_PORT_NAME;

const RuntimeListModelsRpc = Rpc.make("listModels", {
  payload: {
    origin: Schema.optional(Schema.String),
    connectedOnly: Schema.optional(Schema.Boolean),
    providerID: Schema.optional(Schema.String),
  },
  success: Schema.Array(RuntimeModelSummarySchema),
  error: RuntimeRpcErrorSchema,
});

const RuntimeGetOriginStateRpc = Rpc.make("getOriginState", {
  payload: {
    origin: Schema.String,
  },
  success: RuntimeOriginStateSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeListPendingRpc = Rpc.make("listPending", {
  payload: {
    origin: Schema.String,
  },
  success: Schema.Array(RuntimePendingRequestSchema),
  error: RuntimeRpcErrorSchema,
});

const RuntimeAcquireModelRpc = Rpc.make("acquireModel", {
  payload: RuntimeAcquireModelInputSchema,
  success: RuntimeModelDescriptorSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeModelDoGenerateRpc = Rpc.make("modelDoGenerate", {
  payload: RuntimeModelCallInputSchema,
  success: RuntimeGenerateResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeModelDoStreamRpc = Rpc.make("modelDoStream", {
  payload: RuntimeModelCallInputSchema,
  success: RuntimeStreamPartSchema,
  stream: true,
  error: RuntimeRpcErrorSchema,
});

const RuntimeAbortModelCallRpc = Rpc.make("abortModelCall", {
  payload: RuntimeAbortModelCallInputSchema,
  success: Schema.Void,
  error: RuntimeRpcErrorSchema,
});

const RuntimePublicRequestPermissionRpc = Rpc.make("requestPermission", {
  payload: RuntimeCreatePermissionRequestInputSchema,
  success: RuntimeCreatePermissionRequestResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeListProvidersRpc = Rpc.make("listProviders", {
  payload: {},
  success: Schema.Array(RuntimeProviderSummarySchema),
  error: RuntimeRpcErrorSchema,
});

const RuntimeListConnectedModelsRpc = Rpc.make("listConnectedModels", {
  payload: {},
  success: Schema.Array(RuntimeModelSummarySchema),
  error: RuntimeRpcErrorSchema,
});

const RuntimeListPermissionsRpc = Rpc.make("listPermissions", {
  payload: {
    origin: Schema.String,
  },
  success: Schema.Array(RuntimePermissionEntrySchema),
  error: RuntimeRpcErrorSchema,
});

const RuntimeOpenProviderAuthWindowRpc = Rpc.make("openProviderAuthWindow", {
  payload: {
    providerID: Schema.String,
  },
  success: RuntimeOpenProviderAuthWindowResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeGetProviderAuthFlowRpc = Rpc.make("getProviderAuthFlow", {
  payload: {
    providerID: Schema.String,
  },
  success: Schema.Struct({
    providerID: Schema.String,
    result: RuntimeAuthFlowSnapshotSchema,
  }),
  error: RuntimeRpcErrorSchema,
});

const RuntimeStartProviderAuthFlowRpc = Rpc.make("startProviderAuthFlow", {
  payload: {
    providerID: Schema.String,
    methodID: Schema.String,
    values: Schema.optional(
      Schema.Record({ key: Schema.String, value: Schema.String }),
    ),
  },
  success: RuntimeStartProviderAuthFlowResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeCancelProviderAuthFlowRpc = Rpc.make("cancelProviderAuthFlow", {
  payload: {
    providerID: Schema.String,
    reason: Schema.optional(Schema.String),
  },
  success: RuntimeCancelProviderAuthFlowResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeDisconnectProviderRpc = Rpc.make("disconnectProvider", {
  payload: {
    providerID: Schema.String,
  },
  success: RuntimeDisconnectProviderResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeUpdatePermissionRpc = Rpc.make("updatePermission", {
  payload: RuntimeUpdatePermissionInputSchema,
  success: Schema.Union(
    RuntimeSetOriginEnabledResponseSchema,
    RuntimeUpdatePermissionResponseSchema,
  ),
  error: RuntimeRpcErrorSchema,
});

const RuntimeAdminRequestPermissionRpc = Rpc.make("requestPermission", {
  payload: RuntimeRequestPermissionInputSchema,
  success: Schema.Union(
    RuntimeCreatePermissionRequestResponseSchema,
    RuntimeDismissPermissionRequestResponseSchema,
    RuntimeResolvePermissionRequestResponseSchema,
  ),
  error: RuntimeRpcErrorSchema,
});

const RuntimeSharedRpcs = [
  RuntimeListModelsRpc,
  RuntimeGetOriginStateRpc,
  RuntimeListPendingRpc,
  RuntimeAcquireModelRpc,
  RuntimeModelDoGenerateRpc,
  RuntimeModelDoStreamRpc,
  RuntimeAbortModelCallRpc,
] as const;

const RuntimePublicOnlyRpcs = [RuntimePublicRequestPermissionRpc] as const;

const RuntimeAdminOnlyRpcs = [
  RuntimeListProvidersRpc,
  RuntimeListConnectedModelsRpc,
  RuntimeListPermissionsRpc,
  RuntimeOpenProviderAuthWindowRpc,
  RuntimeGetProviderAuthFlowRpc,
  RuntimeStartProviderAuthFlowRpc,
  RuntimeCancelProviderAuthFlowRpc,
  RuntimeDisconnectProviderRpc,
  RuntimeUpdatePermissionRpc,
  RuntimeAdminRequestPermissionRpc,
] as const;

export const RuntimePublicRpcGroup = RpcGroup.make(
  ...RuntimeSharedRpcs,
  ...RuntimePublicOnlyRpcs,
);

export type RuntimePublicRpc = RpcGroup.Rpcs<typeof RuntimePublicRpcGroup>;

export const RuntimeAdminRpcGroup = RpcGroup.make(
  ...RuntimeSharedRpcs,
  ...RuntimeAdminOnlyRpcs,
);

export type RuntimeAdminRpc = RpcGroup.Rpcs<typeof RuntimeAdminRpcGroup>;
