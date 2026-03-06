import * as Schema from "effect/Schema"

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
)

export type RuntimeRpcError = Schema.Schema.Type<typeof RuntimeRpcErrorSchema>

export function isRuntimeRpcError(error: unknown): error is RuntimeRpcError {
  return (
    error instanceof PermissionDeniedError
    || error instanceof ModelNotFoundError
    || error instanceof ProviderNotConnectedError
    || error instanceof AuthFlowExpiredError
    || error instanceof TransportProtocolError
    || error instanceof RuntimeAuthorizationError
    || error instanceof RuntimeUpstreamServiceError
    || error instanceof RuntimeAuthProviderError
    || error instanceof RuntimeInternalError
    || error instanceof RuntimeValidationError
  )
}

export function toRuntimeRpcError(error: unknown): RuntimeRpcError {
  if (isRuntimeRpcError(error)) return error

  if (error instanceof TypeError) {
    return new RuntimeValidationError({
      message: "Invalid runtime input",
    })
  }

  return new RuntimeInternalError({
    message: "Internal runtime error",
  })
}
