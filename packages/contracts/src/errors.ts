import * as Schema from "effect/Schema";
import { RpcClientError } from "@effect/rpc/RpcClientError";
export { RpcClientError };

export class PermissionDeniedError extends Schema.TaggedError<PermissionDeniedError>(
  "PermissionDeniedError",
)("PermissionDeniedError", {
  origin: Schema.String,
  modelId: Schema.String,
  message: Schema.String,
}) {}

export class ModelNotFoundError extends Schema.TaggedError<ModelNotFoundError>(
  "ModelNotFoundError",
)("ModelNotFoundError", {
  modelId: Schema.String,
  message: Schema.String,
}) {}

export class ProviderNotConnectedError extends Schema.TaggedError<ProviderNotConnectedError>(
  "ProviderNotConnectedError",
)("ProviderNotConnectedError", {
  providerID: Schema.String,
  message: Schema.String,
}) {}

export class AuthFlowExpiredError extends Schema.TaggedError<AuthFlowExpiredError>(
  "AuthFlowExpiredError",
)("AuthFlowExpiredError", {
  providerID: Schema.String,
  message: Schema.String,
}) {}

export class TransportProtocolError extends Schema.TaggedError<TransportProtocolError>(
  "TransportProtocolError",
)("TransportProtocolError", {
  message: Schema.String,
}) {}

export class RuntimeAuthorizationError extends Schema.TaggedError<RuntimeAuthorizationError>(
  "RuntimeAuthorizationError",
)("RuntimeAuthorizationError", {
  operation: Schema.optional(Schema.String),
  message: Schema.String,
}) {}

export class RuntimeUpstreamServiceError extends Schema.TaggedError<RuntimeUpstreamServiceError>(
  "RuntimeUpstreamServiceError",
)("RuntimeUpstreamServiceError", {
  providerID: Schema.String,
  operation: Schema.String,
  statusCode: Schema.optional(Schema.Number),
  responseHeaders: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
  retryable: Schema.Boolean,
  message: Schema.String,
}) {}

export class RuntimeAuthProviderError extends Schema.TaggedError<RuntimeAuthProviderError>(
  "RuntimeAuthProviderError",
)("RuntimeAuthProviderError", {
  providerID: Schema.String,
  operation: Schema.String,
  retryable: Schema.Boolean,
  message: Schema.String,
}) {}

export class RuntimeInternalError extends Schema.TaggedError<RuntimeInternalError>(
  "RuntimeInternalError",
)("RuntimeInternalError", {
  operation: Schema.optional(Schema.String),
  message: Schema.String,
}) {}

export class RuntimeValidationError extends Schema.TaggedError<RuntimeValidationError>(
  "RuntimeValidationError",
)("RuntimeValidationError", {
  message: Schema.String,
}) {}

export class BridgeInitializationTimeoutError extends Schema.TaggedError<BridgeInitializationTimeoutError>(
  "BridgeInitializationTimeoutError",
)("BridgeInitializationTimeoutError", {
  timeoutMs: Schema.Number,
  message: Schema.String,
}) {}

export class RpcProtocolError extends Schema.TaggedError<RpcProtocolError>(
  "RpcProtocolError",
)("RpcProtocolError", {
  reason: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
}) {}

export class BridgeAbortError extends Schema.TaggedError<BridgeAbortError>(
  "BridgeAbortError",
)("BridgeAbortError", {
  message: Schema.String,
}) {}

export class BridgeMessagePortError extends Schema.TaggedError<BridgeMessagePortError>(
  "BridgeMessagePortError",
)("BridgeMessagePortError", {
  message: Schema.String,
}) {}

export class RuntimeDefectError extends Schema.TaggedError<RuntimeDefectError>(
  "RuntimeDefectError",
)("RuntimeDefectError", {
  defect: Schema.String,
}) {}

export const RuntimeRpcErrorSchema = Schema.Union(
  PermissionDeniedError,
  ModelNotFoundError,
  ProviderNotConnectedError,
  AuthFlowExpiredError,
  TransportProtocolError,
  RuntimeAuthorizationError,
  RuntimeUpstreamServiceError,
  RuntimeAuthProviderError,
  RuntimeInternalError,
  RuntimeValidationError,
  BridgeInitializationTimeoutError,
  RpcProtocolError,
  BridgeAbortError,
  BridgeMessagePortError,
  RuntimeDefectError,
  RpcClientError,
);

export type RuntimeRpcError = Schema.Schema.Type<typeof RuntimeRpcErrorSchema>;

export function isRuntimeRpcError(error: unknown): error is RuntimeRpcError {
  return (
    error instanceof PermissionDeniedError ||
    error instanceof ModelNotFoundError ||
    error instanceof ProviderNotConnectedError ||
    error instanceof AuthFlowExpiredError ||
    error instanceof TransportProtocolError ||
    error instanceof RuntimeAuthorizationError ||
    error instanceof RuntimeUpstreamServiceError ||
    error instanceof RuntimeAuthProviderError ||
    error instanceof RuntimeInternalError ||
    error instanceof RuntimeValidationError ||
    error instanceof BridgeInitializationTimeoutError ||
    error instanceof RpcProtocolError ||
    error instanceof BridgeAbortError ||
    error instanceof BridgeMessagePortError ||
    error instanceof RuntimeDefectError ||
    error instanceof RpcClientError
  );
}
