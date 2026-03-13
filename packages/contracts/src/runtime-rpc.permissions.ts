import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  RuntimeCreatePermissionRequestInputSchema,
  RuntimeCreatePermissionRequestResponseSchema,
  RuntimeDismissPermissionRequestInputSchema,
  RuntimeDismissPermissionRequestResponseSchema,
  RuntimeOriginStateSchema,
  RuntimePendingRequestSchema,
  RuntimePermissionEntrySchema,
  RuntimeResolvePermissionRequestInputSchema,
  RuntimeResolvePermissionRequestResponseSchema,
  RuntimeSetModelPermissionInputSchema,
  RuntimeSetOriginEnabledInputSchema,
  RuntimeSetOriginEnabledResponseSchema,
  RuntimeUpdatePermissionResponseSchema,
} from "./entities";
import { RuntimeRpcErrorSchema } from "./errors";

export const RuntimeOriginPayloadSchema = Schema.Struct({
  origin: Schema.String,
});

export const RuntimeGetOriginStateRpc = Rpc.make("getOriginState", {
  payload: RuntimeOriginPayloadSchema,
  success: RuntimeOriginStateSchema,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeStreamOriginStateRpc = Rpc.make("streamOriginState", {
  payload: RuntimeOriginPayloadSchema,
  success: RuntimeOriginStateSchema,
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeListPendingRpc = Rpc.make("listPending", {
  payload: RuntimeOriginPayloadSchema,
  success: Schema.Array(RuntimePendingRequestSchema),
  error: RuntimeRpcErrorSchema,
});

export const RuntimeStreamPendingRpc = Rpc.make("streamPending", {
  payload: RuntimeOriginPayloadSchema,
  success: Schema.Array(RuntimePendingRequestSchema),
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeListPermissionsRpc = Rpc.make("listPermissions", {
  payload: RuntimeOriginPayloadSchema,
  success: Schema.Array(RuntimePermissionEntrySchema),
  error: RuntimeRpcErrorSchema,
});

export const RuntimeStreamPermissionsRpc = Rpc.make("streamPermissions", {
  payload: RuntimeOriginPayloadSchema,
  success: Schema.Array(RuntimePermissionEntrySchema),
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeCreatePermissionRequestRpc = Rpc.make("createPermissionRequest", {
  payload: RuntimeCreatePermissionRequestInputSchema,
  success: RuntimeCreatePermissionRequestResponseSchema,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeSetOriginEnabledRpc = Rpc.make("setOriginEnabled", {
  payload: RuntimeSetOriginEnabledInputSchema,
  success: RuntimeSetOriginEnabledResponseSchema,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeSetModelPermissionRpc = Rpc.make("setModelPermission", {
  payload: RuntimeSetModelPermissionInputSchema,
  success: RuntimeUpdatePermissionResponseSchema,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeResolvePermissionRequestRpc = Rpc.make(
  "resolvePermissionRequest",
  {
    payload: RuntimeResolvePermissionRequestInputSchema,
    success: RuntimeResolvePermissionRequestResponseSchema,
    error: RuntimeRpcErrorSchema,
  },
);

export const RuntimeDismissPermissionRequestRpc = Rpc.make(
  "dismissPermissionRequest",
  {
    payload: RuntimeDismissPermissionRequestInputSchema,
    success: RuntimeDismissPermissionRequestResponseSchema,
    error: RuntimeRpcErrorSchema,
  },
);

export const RuntimePermissionsRpcGroup = RpcGroup.make(
  RuntimeGetOriginStateRpc,
  RuntimeStreamOriginStateRpc,
  RuntimeListPendingRpc,
  RuntimeStreamPendingRpc,
  RuntimeListPermissionsRpc,
  RuntimeStreamPermissionsRpc,
  RuntimeCreatePermissionRequestRpc,
  RuntimeSetOriginEnabledRpc,
  RuntimeSetModelPermissionRpc,
  RuntimeResolvePermissionRequestRpc,
  RuntimeDismissPermissionRequestRpc,
);
