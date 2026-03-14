import { APICallError } from "@ai-sdk/provider";
import { RetryError } from "ai";
import { toRuntimeStreamPart } from "@llm-bridge/bridge-codecs";
import { isRuntimeRpcError } from "@llm-bridge/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import {
  prepareRuntimeLanguageModelCall,
  type RuntimeLanguageModelCallOptions,
} from "./language-model-runtime-context";
import { readableStreamToEffectStream } from "@/background/runtime/interop/ai-sdk-interop";
import {
  wrapExtensionError,
  wrapProviderError,
} from "@/background/runtime/core/errors";

function logRuntimeModelDebug(event: string, details?: unknown) {
  console.log(`[language-model-runtime] ${event}`, details);
}

function logRuntimeModelError(
  event: string,
  error: unknown,
  details?: unknown,
) {
  console.error(`[language-model-runtime] ${event}`, {
    details,
    error,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

function wrapProviderStyleFailure<A>(
  effect: Effect.Effect<A, unknown>,
  input: {
    operation: string;
    providerID: string;
  },
) {
  return effect.pipe(
    Effect.catchAll((error) =>
      error instanceof Error &&
      (APICallError.isInstance(error) || RetryError.isInstance(error))
        ? Effect.fail(
            wrapProviderError(error, input.providerID, input.operation),
          )
        : Effect.die(error),
    ),
  );
}

function toRuntimeStreamError(input: {
  error: unknown;
  operation: string;
  providerID: string;
}) {
  if (isRuntimeRpcError(input.error)) {
    return input.error;
  }

  if (
    input.error instanceof Error &&
    (APICallError.isInstance(input.error) || RetryError.isInstance(input.error))
  ) {
    return wrapProviderError(input.error, input.providerID, input.operation);
  }

  return wrapExtensionError(input.error, input.operation);
}

export function getRuntimeModelDescriptor(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
}) {
  return Effect.gen(function* () {
    const preparedCall = yield* prepareRuntimeLanguageModelCall({
      modelID: input.modelID,
      origin: input.origin,
      sessionID: input.sessionID,
      requestID: input.requestID,
      options: {
        prompt: [
          {
            role: "system",
            content: "describe capabilities",
          },
        ],
      } satisfies RuntimeLanguageModelCallOptions,
    });

    const supportedUrls = yield* wrapProviderStyleFailure(
      Effect.try({
        try: () => preparedCall.languageModel.supportedUrls,
        catch: (error) => error,
      }).pipe(
        Effect.flatMap((value) =>
          Effect.tryPromise({
            try: () => Promise.resolve(value ?? {}),
            catch: (error) => error,
          }),
        ),
      ),
      {
        providerID: preparedCall.providerID,
        operation: "describe",
      },
    );

    return {
      provider: preparedCall.languageModel.provider,
      modelId: input.modelID,
      supportedUrls,
    };
  });
}

export function runLanguageModelGenerate(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
  signal?: AbortSignal;
}) {
  logRuntimeModelDebug("generate.started", input);

  return Effect.gen(function* () {
    const preparedCall = yield* prepareRuntimeLanguageModelCall(input);

    const result = yield* wrapProviderStyleFailure(
      Effect.tryPromise({
        try: () =>
          preparedCall.languageModel.doGenerate({
            ...preparedCall.callOptions,
            abortSignal: input.signal,
          }),
        catch: (error) => error,
      }),
      {
        providerID: preparedCall.providerID,
        operation: "generate",
      },
    );

    logRuntimeModelDebug("generate.succeeded", {
      providerID: preparedCall.providerID,
      providerModelID: preparedCall.providerModelID,
      ...input,
    });
    return result;
  }).pipe(
    Effect.catchAllCause((cause) => {
      logRuntimeModelError(
        "generate.failed",
        Cause.squash(cause) instanceof Error
          ? (Cause.squash(cause) as Error)
          : new Error(String(Cause.squash(cause))),
        input,
      );
      return Effect.failCause(cause);
    }),
  );
}

export function runLanguageModelStream(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
  signal?: AbortSignal;
}) {
  logRuntimeModelDebug("stream.started", input);

  return Effect.gen(function* () {
    const preparedCall = yield* prepareRuntimeLanguageModelCall(input);

    const result = yield* wrapProviderStyleFailure(
      Effect.tryPromise({
        try: () =>
          preparedCall.languageModel.doStream({
            ...preparedCall.callOptions,
            abortSignal: input.signal,
          }),
        catch: (error) => error,
      }),
      {
        providerID: preparedCall.providerID,
        operation: "stream",
      },
    );

    logRuntimeModelDebug("stream.succeeded", {
      providerID: preparedCall.providerID,
      providerModelID: preparedCall.providerModelID,
      ...input,
    });
    return readableStreamToEffectStream({
      stream: result.stream,
      map: (part) => Effect.succeed(toRuntimeStreamPart(part)),
      mapError: (error) =>
        toRuntimeStreamError({
          error,
          providerID: preparedCall.providerID,
          operation: "stream",
        }),
    });
  }).pipe(
    Effect.catchAllCause((cause) => {
      logRuntimeModelError(
        "stream.failed",
        Cause.squash(cause) instanceof Error
          ? (Cause.squash(cause) as Error)
          : new Error(String(Cause.squash(cause))),
        input,
      );
      return Effect.failCause(cause);
    }),
  );
}
