import { APICallError } from "@ai-sdk/provider";
import {
  BridgeAbortError,
  JsonValueSchema,
  RuntimeDefectError,
  RuntimeUpstreamServiceError,
  RuntimeValidationError,
  type JsonValue,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import * as Schema from "effect/Schema";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const CONNECTION_INVALIDATED_MESSAGE =
  "Bridge connection was destroyed while connecting";

const decodeJsonValue = Schema.decodeUnknownSync(JsonValueSchema);

export function createAbortError() {
  return new BridgeAbortError({
    message: "The operation was aborted",
  });
}

export function createUnsupportedChatTransportHeadersError() {
  return new RuntimeValidationError({
    message:
      "Bridge chat transport does not support per-request headers. Use prepareSendMessages to set model call headers instead.",
  });
}

export function createMissingChatModelIdError() {
  return new RuntimeValidationError({
    message:
      "Bridge chat transport requires request body.modelId to be a non-empty string.",
  });
}

function createBridgeModelCallUrl(
  operation: "generate" | "stream",
  modelId: string,
) {
  return `llm-bridge://${operation}/${encodeURIComponent(modelId)}`;
}

function toResponseHeaders(error: RuntimeUpstreamServiceError) {
  if (error.responseHeaders && Object.keys(error.responseHeaders).length > 0) {
    return error.responseHeaders;
  }
  return undefined;
}

export function normalizeModelCallError(input: {
  error: unknown;
  operation: "generate" | "stream";
  modelId: string;
  requestBodyValues: unknown;
}) {
  if (!(input.error instanceof RuntimeUpstreamServiceError)) {
    return input.error;
  }

  return new APICallError({
    message: input.error.message,
    url: createBridgeModelCallUrl(input.operation, input.modelId),
    requestBodyValues: input.requestBodyValues,
    statusCode: input.error.statusCode,
    responseHeaders: toResponseHeaders(input.error),
    isRetryable: input.error.retryable,
    cause: input.error,
  });
}

export function isBootstrapRuntimeStreamPart(part: { type: string }) {
  return (
    part.type === "stream-start" ||
    part.type === "response-metadata" ||
    part.type === "raw"
  );
}

function isJsonObject(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toOpaqueJsonObject(
  value: object,
  operation: string,
): { readonly [key: string]: JsonValue } {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new RuntimeValidationError({
      message: `${operation} must be JSON serializable`,
    });
  }

  const parsed = decodeJsonValue(JSON.parse(serialized));
  if (!isJsonObject(parsed)) {
    throw new RuntimeValidationError({
      message: `${operation} must encode to a JSON object`,
    });
  }

  return parsed;
}

export function hasRequestHeaders(
  headers: Headers | Record<string, string> | undefined,
) {
  if (!headers) {
    return false;
  }

  if (headers instanceof Headers) {
    return [...headers.keys()].length > 0;
  }

  return Object.keys(headers).length > 0;
}

export function toBridgeDefect(error: RuntimeRpcError | Error) {
  return error instanceof Error
    ? error
    : new RuntimeDefectError({
        defect: String(error),
      });
}

export function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nextRequestId(sequence: number) {
  return `req_${Date.now()}_${sequence}`;
}

export type BrowserWindowLike = Window & typeof globalThis;

export function requireBrowserWindow(): BrowserWindowLike {
  if (
    typeof window === "undefined" ||
    typeof window.location?.origin !== "string" ||
    window.location.origin.length === 0
  ) {
    throw new RuntimeValidationError({
      message:
        "Bridge client requires a trusted browser window origin.",
    });
  }

  return window;
}

export function logBridgeDebug(event: string, details?: unknown) {
  console.log(`[bridge-client] ${event}`, details);
}

export function logBridgeError(
  event: string,
  error: unknown,
  details?: unknown,
) {
  console.error(`[bridge-client] ${event}`, {
    details,
    error,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}
