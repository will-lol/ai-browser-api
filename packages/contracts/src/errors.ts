import { RpcClientError } from "@effect/rpc/RpcClientError";
import * as Schema from "effect/Schema";

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

export class RuntimeThrownError extends Schema.TaggedError<RuntimeThrownError>(
  "RuntimeThrownError",
)("RuntimeThrownError", {
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
}) {}

export class RuntimeUnknownValueError extends Schema.TaggedError<RuntimeUnknownValueError>(
  "RuntimeUnknownValueError",
)("RuntimeUnknownValueError", {
  value: Schema.String,
}) {}

export class RuntimeTransportError extends Schema.TaggedError<RuntimeTransportError>(
  "RuntimeTransportError",
)("RuntimeTransportError", {
  source: Schema.Union(
    Schema.Literal("rpc-client"),
    Schema.Literal("rpc-server"),
    Schema.Literal("page-bridge"),
    Schema.Literal("runtime-port"),
  ),
  reason: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
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
  RuntimeThrownError,
  RuntimeUnknownValueError,
  RuntimeTransportError,
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
    error instanceof RuntimeThrownError ||
    error instanceof RuntimeUnknownValueError ||
    error instanceof RuntimeTransportError
  );
}

function logSerializedRuntimeRpcError(message: string, error: unknown) {
  console.error(message, {
    error,
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

export function serializeRpcClientError(
  error: RpcClientError,
  source: RuntimeTransportError["source"],
): RuntimeTransportError {
  return new RuntimeTransportError({
    source,
    reason: error.reason,
    message: error.message,
    stack: error.stack,
  });
}

export function serializeUnknownRuntimeError(error: unknown): RuntimeRpcError {
  if (isRuntimeRpcError(error)) {
    return error;
  }

  if (error instanceof RpcClientError) {
    return serializeRpcClientError(error, "rpc-client");
  }

  if (error instanceof Error) {
    logSerializedRuntimeRpcError(
      "[runtime-rpc] serializing native Error to RuntimeThrownError",
      error,
    );
    return new RuntimeThrownError({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }

  logSerializedRuntimeRpcError(
    "[runtime-rpc] serializing unknown thrown value to RuntimeUnknownValueError",
    error,
  );
  return new RuntimeUnknownValueError({
    value: String(error),
  });
}
