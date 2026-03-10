import { describe, expect, it } from "bun:test";
import { APICallError } from "@ai-sdk/provider";
import { RetryError } from "ai";
import {
  RuntimeAuthProviderError,
  RuntimeInternalError,
  RuntimeUpstreamServiceError,
  TransportProtocolError,
} from "@llm-bridge/contracts";
import {
  wrapAuthPluginError,
  wrapExtensionError,
  wrapProviderError,
  wrapStorageError,
  wrapTransportError,
} from "@/background/runtime/errors";

describe("runtime error wrappers", () => {
  it("extracts retry-after-ms from AI SDK API call errors", () => {
    const wrapped = wrapProviderError(
      new APICallError({
        message: "Rate limited",
        url: "https://api.example.test",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: {
          "retry-after-ms": "2500",
        },
        isRetryable: true,
      }),
      "openai",
      "generate",
    );

    expect(wrapped).toBeInstanceOf(RuntimeUpstreamServiceError);
    expect(wrapped.responseHeaders).toEqual({
      "retry-after-ms": "2500",
    });
    expect(wrapped.statusCode).toBe(429);
    expect(wrapped.retryable).toBe(true);
  });

  it("extracts numeric retry-after seconds from AI SDK API call errors", () => {
    const wrapped = wrapProviderError(
      new APICallError({
        message: "Busy",
        url: "https://api.example.test",
        requestBodyValues: {},
        statusCode: 503,
        responseHeaders: {
          "retry-after": "7",
        },
        isRetryable: true,
      }),
      "openai",
      "stream",
    );

    expect(wrapped.responseHeaders).toEqual({
      "retry-after": "7",
    });
    expect(wrapped.statusCode).toBe(503);
  });

  it("preserves HTTP-date retry-after values from AI SDK API call errors", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const wrapped = wrapProviderError(
      new APICallError({
        message: "Try later",
        url: "https://api.example.test",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: {
          "retry-after": future,
        },
        isRetryable: true,
      }),
      "openai",
      "generate",
    );

    expect(wrapped.responseHeaders).toEqual({
      "retry-after": future,
    });
  });

  it("unwraps RetryError.lastError before classifying provider failures", () => {
    const wrapped = wrapProviderError(
      new RetryError({
        message: "Failed after retries",
        reason: "maxRetriesExceeded",
        errors: [
          new APICallError({
            message: "Rate limited",
            url: "https://api.example.test",
            requestBodyValues: {},
            statusCode: 429,
            responseHeaders: {
              "retry-after": "3",
            },
            isRetryable: true,
          }),
        ],
      }),
      "openai",
      "generate",
    );

    expect(wrapped).toMatchObject({
      _tag: "RuntimeUpstreamServiceError",
      providerID: "openai",
      operation: "generate",
      statusCode: 429,
      responseHeaders: {
        "retry-after": "3",
      },
      retryable: true,
      message: "Rate limited",
    } satisfies Partial<RuntimeUpstreamServiceError>);
  });

  it("wraps plain errors for auth, storage, transport, and extension boundaries", () => {
    expect(
      wrapAuthPluginError(
        new Error("plugin failed"),
        "gitlab",
        "auth.authorize",
      ),
    ).toEqual(
      new RuntimeAuthProviderError({
        providerID: "gitlab",
        operation: "auth.authorize",
        retryable: false,
        message: "plugin failed",
      }),
    );
    expect(
      wrapStorageError(new Error("db failed"), "query.listProviders"),
    ).toEqual(
      new RuntimeInternalError({
        operation: "query.listProviders",
        message: "db failed",
      }),
    );
    expect(wrapExtensionError("bad state", "runtime.rpc")).toEqual(
      new RuntimeInternalError({
        operation: "runtime.rpc",
        message: "bad state",
      }),
    );
    expect(wrapTransportError(new Error("socket closed"))).toEqual(
      new TransportProtocolError({
        message: "socket closed",
      }),
    );
  });
});
