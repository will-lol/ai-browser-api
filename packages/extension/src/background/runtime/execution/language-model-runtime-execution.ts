import { APICallError } from "@ai-sdk/provider";
import { RetryError } from "ai";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import {
  prepareRuntimeLanguageModelCall,
  type RuntimeLanguageModelCallOptions,
} from "./language-model-runtime-context";
import { wrapProviderError } from "@/background/runtime/core/errors";

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

    const supportedUrls = yield* Effect.promise(() =>
      Promise.resolve(preparedCall.languageModel.supportedUrls ?? {}),
    ).pipe(
      Effect.catchAllDefect((defect) =>
        defect instanceof Error &&
        (APICallError.isInstance(defect) || RetryError.isInstance(defect))
          ? Effect.fail(
              wrapProviderError(defect, preparedCall.providerID, "describe"),
            )
          : Effect.die(defect),
      ),
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

    const result = yield* Effect.promise(() =>
      preparedCall.languageModel.doGenerate({
        ...preparedCall.callOptions,
        abortSignal: input.signal,
      }),
    ).pipe(
      Effect.catchAllDefect((defect) =>
        defect instanceof Error &&
        (APICallError.isInstance(defect) || RetryError.isInstance(defect))
          ? Effect.fail(
              wrapProviderError(defect, preparedCall.providerID, "generate"),
            )
          : Effect.die(defect),
      ),
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

    const result = yield* Effect.promise(() =>
      preparedCall.languageModel.doStream({
        ...preparedCall.callOptions,
        abortSignal: input.signal,
      }),
    ).pipe(
      Effect.catchAllDefect((defect) =>
        defect instanceof Error &&
        (APICallError.isInstance(defect) || RetryError.isInstance(defect))
          ? Effect.fail(
              wrapProviderError(defect, preparedCall.providerID, "stream"),
            )
          : Effect.die(defect),
      ),
    );

    logRuntimeModelDebug("stream.succeeded", {
      providerID: preparedCall.providerID,
      providerModelID: preparedCall.providerModelID,
      ...input,
    });
    return result.stream;
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
