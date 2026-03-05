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
    || error instanceof RuntimeValidationError
  )
}

export function toRuntimeRpcError(error: unknown): RuntimeRpcError {
  if (isRuntimeRpcError(error)) return error

  return new RuntimeValidationError({
    message: error instanceof Error ? error.message : String(error),
  })
}
