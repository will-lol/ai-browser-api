import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  RuntimeAuthFlowSnapshotSchema,
  RuntimeCancelProviderAuthFlowResponseSchema,
  RuntimeDisconnectProviderResponseSchema,
  RuntimeOpenProviderAuthWindowResponseSchema,
  RuntimeStartProviderAuthFlowResponseSchema,
} from "./entities";
import { RuntimeRpcErrorSchema } from "./errors";

export const RuntimeProviderIdPayloadSchema = Schema.Struct({
  providerID: Schema.String,
});

export const RuntimeOpenProviderAuthWindowRpc = Rpc.make("openProviderAuthWindow", {
  payload: RuntimeProviderIdPayloadSchema,
  success: RuntimeOpenProviderAuthWindowResponseSchema,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeGetProviderAuthFlowRpc = Rpc.make("getProviderAuthFlow", {
  payload: RuntimeProviderIdPayloadSchema,
  success: Schema.Struct({
    providerID: Schema.String,
    result: RuntimeAuthFlowSnapshotSchema,
  }),
  error: RuntimeRpcErrorSchema,
});

export const RuntimeStreamProviderAuthFlowRpc = Rpc.make("streamProviderAuthFlow", {
  payload: RuntimeProviderIdPayloadSchema,
  success: Schema.Struct({
    providerID: Schema.String,
    result: RuntimeAuthFlowSnapshotSchema,
  }),
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeStartProviderAuthFlowRpc = Rpc.make("startProviderAuthFlow", {
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

export const RuntimeCancelProviderAuthFlowRpc = Rpc.make("cancelProviderAuthFlow", {
  payload: {
    providerID: Schema.String,
    reason: Schema.optional(Schema.String),
  },
  success: RuntimeCancelProviderAuthFlowResponseSchema,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeDisconnectProviderRpc = Rpc.make("disconnectProvider", {
  payload: RuntimeProviderIdPayloadSchema,
  success: RuntimeDisconnectProviderResponseSchema,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeAuthRpcGroup = RpcGroup.make(
  RuntimeOpenProviderAuthWindowRpc,
  RuntimeGetProviderAuthFlowRpc,
  RuntimeStreamProviderAuthFlowRpc,
  RuntimeStartProviderAuthFlowRpc,
  RuntimeCancelProviderAuthFlowRpc,
  RuntimeDisconnectProviderRpc,
);
