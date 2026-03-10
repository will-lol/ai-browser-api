import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  RuntimeAbortModelCallInputSchema,
  RuntimeAcquireModelInputSchema,
  RuntimeAbortChatStreamInputSchema,
  RuntimeAuthFlowSnapshotSchema,
  RuntimeChatReconnectStreamInputSchema,
  RuntimeChatSendMessagesInputSchema,
  RuntimeChatStreamChunkSchema,
  RuntimeCancelProviderAuthFlowResponseSchema,
  RuntimeCreatePermissionRequestInputSchema,
  RuntimeCreatePermissionRequestResponseSchema,
  RuntimeDismissPermissionRequestInputSchema,
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
  RuntimeResolvePermissionRequestInputSchema,
  RuntimeResolvePermissionRequestResponseSchema,
  RuntimeSetModelPermissionInputSchema,
  RuntimeSetOriginEnabledInputSchema,
  RuntimeSetOriginEnabledResponseSchema,
  RuntimeStartProviderAuthFlowResponseSchema,
  RuntimeStreamPartSchema,
  RuntimeUpdatePermissionResponseSchema,
} from "./entities";
import { RuntimeRpcErrorSchema } from "./errors";

export const RUNTIME_PUBLIC_RPC_PORT_NAME = "llm-bridge-runtime-public-rpc-v1";
export const RUNTIME_ADMIN_RPC_PORT_NAME = "llm-bridge-runtime-admin-rpc-v1";

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

const RuntimeChatSendMessagesRpc = Rpc.make("chatSendMessages", {
  payload: RuntimeChatSendMessagesInputSchema,
  success: RuntimeChatStreamChunkSchema,
  stream: true,
  error: RuntimeRpcErrorSchema,
});

const RuntimeChatReconnectStreamRpc = Rpc.make("chatReconnectStream", {
  payload: RuntimeChatReconnectStreamInputSchema,
  success: RuntimeChatStreamChunkSchema,
  stream: true,
  error: RuntimeRpcErrorSchema,
});

const RuntimeAbortChatStreamRpc = Rpc.make("abortChatStream", {
  payload: RuntimeAbortChatStreamInputSchema,
  success: Schema.Void,
  error: RuntimeRpcErrorSchema,
});

const RuntimeCreatePermissionRequestRpc = Rpc.make("createPermissionRequest", {
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

const RuntimeSetOriginEnabledRpc = Rpc.make("setOriginEnabled", {
  payload: RuntimeSetOriginEnabledInputSchema,
  success: RuntimeSetOriginEnabledResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeSetModelPermissionRpc = Rpc.make("setModelPermission", {
  payload: RuntimeSetModelPermissionInputSchema,
  success: RuntimeUpdatePermissionResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeResolvePermissionRequestRpc = Rpc.make("resolvePermissionRequest", {
  payload: RuntimeResolvePermissionRequestInputSchema,
  success: RuntimeResolvePermissionRequestResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeDismissPermissionRequestRpc = Rpc.make("dismissPermissionRequest", {
  payload: RuntimeDismissPermissionRequestInputSchema,
  success: RuntimeDismissPermissionRequestResponseSchema,
  error: RuntimeRpcErrorSchema,
});

const RuntimeRpcRequests = [
  RuntimeListModelsRpc,
  RuntimeGetOriginStateRpc,
  RuntimeListPendingRpc,
  RuntimeAcquireModelRpc,
  RuntimeModelDoGenerateRpc,
  RuntimeModelDoStreamRpc,
  RuntimeAbortModelCallRpc,
  RuntimeChatSendMessagesRpc,
  RuntimeChatReconnectStreamRpc,
  RuntimeAbortChatStreamRpc,
  RuntimeCreatePermissionRequestRpc,
  RuntimeListProvidersRpc,
  RuntimeListConnectedModelsRpc,
  RuntimeListPermissionsRpc,
  RuntimeOpenProviderAuthWindowRpc,
  RuntimeGetProviderAuthFlowRpc,
  RuntimeStartProviderAuthFlowRpc,
  RuntimeCancelProviderAuthFlowRpc,
  RuntimeDisconnectProviderRpc,
  RuntimeSetOriginEnabledRpc,
  RuntimeSetModelPermissionRpc,
  RuntimeResolvePermissionRequestRpc,
  RuntimeDismissPermissionRequestRpc,
] as const;

export const RuntimeRpcGroup = RpcGroup.make(...RuntimeRpcRequests);

export type RuntimeRpc = RpcGroup.Rpcs<typeof RuntimeRpcGroup>;

export const RuntimePublicAllowedTags = new Set([
  "listModels",
  "getOriginState",
  "listPending",
  "acquireModel",
  "modelDoGenerate",
  "modelDoStream",
  "abortModelCall",
  "chatSendMessages",
  "chatReconnectStream",
  "abortChatStream",
  "createPermissionRequest",
] as const);

export const RuntimeAdminAllowedTags = new Set(
  RuntimeRpcGroup.requests.keys(),
);

export const RuntimePublicRpcGroup = RuntimeRpcGroup;
export const RuntimeAdminRpcGroup = RuntimeRpcGroup;

export type RuntimePublicRpc = RuntimeRpc;
export type RuntimeAdminRpc = RuntimeRpc;
