import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { RuntimeRpcError } from "@llm-bridge/contracts";
import {
  isRuntimeRpcError,
  RuntimeAuthProviderError,
  RuntimeUpstreamServiceError,
} from "@llm-bridge/contracts";
import { decodeSchemaOrUndefined } from "@/background/runtime/core/effect-schema";

function isRetryableStatusCode(statusCode: number) {
  return statusCode >= 500 || statusCode === 429 || statusCode === 408;
}

export function createAdapterErrorFactory(input: {
  providerID: string;
  defaultUpstreamMessage: string;
  logLabel?: string;
}) {
  const authProviderError = (options: {
    operation: string;
    message: string;
    retryable?: boolean;
  }) =>
    new RuntimeAuthProviderError({
      providerID: input.providerID,
      operation: options.operation,
      retryable: options.retryable ?? false,
      message: options.message,
    });

  const upstreamError = (options: {
    operation: string;
    statusCode: number;
    detail?: string;
    message?: string;
  }) => {
    if (input.logLabel) {
      console.error(`${input.logLabel} upstream auth request failed`, {
        operation: options.operation,
        statusCode: options.statusCode,
        detail: options.detail?.slice(0, 500),
      });
    }

    return new RuntimeUpstreamServiceError({
      providerID: input.providerID,
      operation: options.operation,
      statusCode: options.statusCode,
      retryable: isRetryableStatusCode(options.statusCode),
      message: options.message ?? input.defaultUpstreamMessage,
    });
  };

  const toAdapterError = (
    operation: string,
    error: unknown,
    options: {
      message?: string;
      retryable?: boolean;
    } = {},
  ) => {
    if (isRuntimeRpcError(error)) {
      return error;
    }

    return authProviderError({
      operation,
      retryable: options.retryable,
      message:
        options.message ??
        (error instanceof Error ? error.message : String(error)),
    });
  };

  const failIfAborted = (
    signal?: AbortSignal,
    options: {
      operation: string;
      message: string;
      retryable?: boolean;
    } = {
      operation: "auth.abort",
      message: "Authentication canceled.",
      retryable: true,
    },
  ) => {
    if (!signal?.aborted) {
      return Effect.void;
    }

    return Effect.fail(
      authProviderError({
        operation: options.operation,
        message: options.message,
        retryable: options.retryable ?? true,
      }),
    );
  };

  const readResponseDetail = (response: Response, operation: string) =>
    Effect.tryPromise({
      try: () => response.text().catch(() => ""),
      catch: (error) => toAdapterError(operation, error),
    }).pipe(Effect.catchAll(() => Effect.succeed("")));

  const decodeResponseJson = <
    TSchema extends Schema.Schema.AnyNoContext,
  >(options: {
    response: Response;
    schema: TSchema;
    operation: string;
    invalidMessage: string;
  }): Effect.Effect<Schema.Schema.Type<TSchema>, RuntimeRpcError> =>
    Effect.tryPromise({
      try: async () => {
        const payload = await options.response.json().catch(() => undefined);
        const result = decodeSchemaOrUndefined(options.schema, payload);
        if (result) {
          return result;
        }

        throw authProviderError({
          operation: options.operation,
          message: options.invalidMessage,
        });
      },
      catch: (error) => toAdapterError(options.operation, error),
    });

  return {
    authProviderError,
    upstreamError,
    toAdapterError,
    failIfAborted,
    readResponseDetail,
    decodeResponseJson,
  };
}
