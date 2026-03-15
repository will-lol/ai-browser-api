import * as RpcGroup from "@effect/rpc/RpcGroup";
import {
  RuntimeAuthRpcGroup,
} from "./runtime-rpc.auth";
import {
  RuntimeCatalogRpcGroup,
  RuntimeListModelsRpc,
  RuntimeStreamModelsRpc,
} from "./runtime-rpc.catalog";
import {
  RuntimeAbortChatStreamRpc,
  RuntimeAbortModelCallRpc,
  RuntimeAcquireModelRpc,
  RuntimeChatReconnectStreamRpc,
  RuntimeChatSendMessagesRpc,
  RuntimeExecutionRpcGroup,
  RuntimeModelDoGenerateRpc,
  RuntimeModelDoStreamRpc,
} from "./runtime-rpc.execution";
import {
  RuntimeCreatePermissionRequestRpc,
  RuntimeGetOriginStateRpc,
  RuntimeListPendingRpc,
  RuntimePermissionsRpcGroup,
} from "./runtime-rpc.permissions";

export const RUNTIME_PUBLIC_RPC_PORT_NAME = "llm-bridge-runtime-public-rpc-v1";
export const RUNTIME_ADMIN_RPC_PORT_NAME = "llm-bridge-runtime-admin-rpc-v1";

export {
  RuntimeAuthRpcGroup,
  RuntimeGetProviderAuthFlowRpc,
  RuntimeOpenProviderAuthWindowRpc,
  RuntimeStreamProviderAuthFlowRpc,
  RuntimeCancelProviderAuthFlowRpc,
  RuntimeDisconnectProviderRpc,
  RuntimeStartProviderAuthFlowRpc,
} from "./runtime-rpc.auth";
export {
  RuntimeCatalogRpcGroup,
  RuntimeListModelsPayloadSchema,
  RuntimeListProvidersPayloadSchema,
  RuntimeListModelsRpc,
  RuntimeListProvidersRpc,
  RuntimeListConnectedModelsRpc,
  RuntimeStreamModelsRpc,
  RuntimeStreamProvidersRpc,
} from "./runtime-rpc.catalog";
export {
  RuntimeAcquireModelRpc,
  RuntimeAbortChatStreamRpc,
  RuntimeAbortModelCallRpc,
  RuntimeChatReconnectStreamRpc,
  RuntimeChatSendMessagesRpc,
  RuntimeExecutionRpcGroup as RuntimeModelExecutionRpcGroup,
  RuntimeModelDoGenerateRpc,
  RuntimeModelDoStreamRpc,
} from "./runtime-rpc.execution";
export {
  RuntimeCreatePermissionRequestRpc,
  RuntimeDismissPermissionRequestRpc,
  RuntimeGetOriginStateRpc,
  RuntimeListPendingRpc,
  RuntimeListPermissionsRpc,
  RuntimeOriginPayloadSchema,
  RuntimeResolvePermissionRequestRpc,
  RuntimeSetModelPermissionRpc,
  RuntimeSetOriginEnabledRpc,
  RuntimeStreamOriginStateRpc,
  RuntimeStreamPendingRpc,
  RuntimeStreamPermissionsRpc,
  RuntimePermissionsRpcGroup,
} from "./runtime-rpc.permissions";

export const RuntimeRpcGroup = RuntimeExecutionRpcGroup.merge(
  RuntimeCatalogRpcGroup,
  RuntimePermissionsRpcGroup,
  RuntimeAuthRpcGroup,
);

export type RuntimeRpc = RpcGroup.Rpcs<typeof RuntimeRpcGroup>;

export const RuntimePublicRpcGroup = RpcGroup.make(
  RuntimeListModelsRpc,
  RuntimeStreamModelsRpc,
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
);

export const RuntimeAdminRpcGroup = RuntimeRpcGroup;

export const RuntimePublicAllowedTags = new Set(
  RuntimePublicRpcGroup.requests.keys(),
);

export const RuntimeAdminAllowedTags = new Set(
  RuntimeAdminRpcGroup.requests.keys(),
);

export type RuntimePublicRpc = RpcGroup.Rpcs<typeof RuntimePublicRpcGroup>;
export type RuntimeAdminRpc = RpcGroup.Rpcs<typeof RuntimeAdminRpcGroup>;
