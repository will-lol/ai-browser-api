import { APICallError } from "@ai-sdk/provider";
import { RetryError } from "ai";
import {
  RuntimeAuthProviderError,
  RuntimeInternalError,
  RuntimeUpstreamServiceError,
  TransportProtocolError,
} from "@llm-bridge/contracts";

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function unwrapRetryError(error: unknown) {
  if (
    error instanceof Error &&
    RetryError.isInstance(error) &&
    error.lastError !== undefined
  ) {
    return error.lastError;
  }

  return error;
}

export function wrapProviderError(
  error: unknown,
  providerID: string,
  operation: string,
): RuntimeUpstreamServiceError {
  const normalized = unwrapRetryError(error);

  if (normalized instanceof Error && APICallError.isInstance(normalized)) {
    return new RuntimeUpstreamServiceError({
      providerID,
      operation,
      statusCode: normalized.statusCode,
      responseHeaders: normalized.responseHeaders,
      retryable: normalized.isRetryable,
      message: normalized.message,
    });
  }

  return new RuntimeUpstreamServiceError({
    providerID,
    operation,
    retryable:
      error instanceof Error && RetryError.isInstance(error) ? true : false,
    message: messageFromError(normalized),
  });
}

export function wrapTransportError(error: unknown): TransportProtocolError {
  return new TransportProtocolError({
    message: messageFromError(error),
  });
}

export function wrapAuthPluginError(
  error: unknown,
  providerID: string,
  operation: string,
): RuntimeAuthProviderError {
  return new RuntimeAuthProviderError({
    providerID,
    operation,
    retryable: false,
    message: messageFromError(error),
  });
}

export function wrapStorageError(
  error: unknown,
  operation: string,
): RuntimeInternalError {
  return new RuntimeInternalError({
    operation,
    message: messageFromError(error),
  });
}

export function wrapExtensionError(
  error: unknown,
  operation: string,
): RuntimeInternalError {
  return new RuntimeInternalError({
    operation,
    message: messageFromError(error),
  });
}
