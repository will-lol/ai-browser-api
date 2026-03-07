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

function parseRetryAfterSeconds(headers?: Record<string, string>) {
  if (!headers) return undefined;

  const retryAfterMs = headers["retry-after-ms"];
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed / 1000;
    }
  }

  const retryAfter = headers["retry-after"];
  if (!retryAfter) return undefined;

  const parsedSeconds = Number.parseFloat(retryAfter);
  if (!Number.isNaN(parsedSeconds) && parsedSeconds >= 0) {
    return parsedSeconds;
  }

  const parsedDate = Date.parse(retryAfter);
  if (Number.isNaN(parsedDate)) return undefined;

  const seconds = (parsedDate - Date.now()) / 1000;
  return seconds >= 0 ? seconds : undefined;
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
      retryAfter: parseRetryAfterSeconds(normalized.responseHeaders),
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
