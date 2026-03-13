import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";
import {
  RuntimeModelSummarySchema,
  RuntimeProviderSummarySchema,
} from "./entities";
import { RuntimeRpcErrorSchema } from "./errors";

export const RuntimeListProvidersPayloadSchema = Schema.Struct({});

export const RuntimeListModelsPayloadSchema = Schema.Struct({
  origin: Schema.optional(Schema.String),
  connectedOnly: Schema.optional(Schema.Boolean),
  providerID: Schema.optional(Schema.String),
});

export const RuntimeListProvidersRpc = Rpc.make("listProviders", {
  payload: RuntimeListProvidersPayloadSchema,
  success: Schema.Array(RuntimeProviderSummarySchema),
  error: RuntimeRpcErrorSchema,
});

export const RuntimeStreamProvidersRpc = Rpc.make("streamProviders", {
  payload: RuntimeListProvidersPayloadSchema,
  success: Schema.Array(RuntimeProviderSummarySchema),
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeListModelsRpc = Rpc.make("listModels", {
  payload: RuntimeListModelsPayloadSchema,
  success: Schema.Array(RuntimeModelSummarySchema),
  error: RuntimeRpcErrorSchema,
});

export const RuntimeStreamModelsRpc = Rpc.make("streamModels", {
  payload: RuntimeListModelsPayloadSchema,
  success: Schema.Array(RuntimeModelSummarySchema),
  stream: true,
  error: RuntimeRpcErrorSchema,
});

export const RuntimeListConnectedModelsRpc = Rpc.make("listConnectedModels", {
  payload: RuntimeListProvidersPayloadSchema,
  success: Schema.Array(RuntimeModelSummarySchema),
  error: RuntimeRpcErrorSchema,
});

export const RuntimeCatalogRpcGroup = RpcGroup.make(
  RuntimeListProvidersRpc,
  RuntimeStreamProvidersRpc,
  RuntimeListModelsRpc,
  RuntimeStreamModelsRpc,
  RuntimeListConnectedModelsRpc,
);
