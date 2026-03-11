import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { APICallError } from "@ai-sdk/provider";
import { RetryError } from "ai";
import { isRuntimeRpcError } from "@llm-bridge/contracts";
import {
  prepareRuntimeLanguageModelCall,
  type RuntimeLanguageModelCallOptions,
} from "./language-model-runtime-context";
import { wrapExtensionError, wrapProviderError } from "@/background/runtime/core/errors";

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

export async function getRuntimeModelDescriptor(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
}) {
  let providerID: string | undefined;

  try {
    const preparedCall = await prepareRuntimeLanguageModelCall({
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

    providerID = preparedCall.providerID;
    const supportedUrls = await Promise.resolve(
      preparedCall.languageModel.supportedUrls ?? {},
    );

    return {
      provider: preparedCall.languageModel.provider,
      modelId: input.modelID,
      supportedUrls,
    };
  } catch (error) {
    if (isRuntimeRpcError(error)) throw error;
    if (
      providerID &&
      error instanceof Error &&
      (APICallError.isInstance(error) || RetryError.isInstance(error))
    ) {
      throw wrapProviderError(error, providerID, "describe");
    }
    throw wrapExtensionError(error, "model.describe");
  }
}

export async function runLanguageModelGenerate(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
  signal?: AbortSignal;
}): Promise<LanguageModelV3GenerateResult> {
  logRuntimeModelDebug("generate.started", input);

  let providerID: string | undefined;

  try {
    const preparedCall = await prepareRuntimeLanguageModelCall(input);
    providerID = preparedCall.providerID;

    const result = await preparedCall.languageModel.doGenerate({
      ...preparedCall.callOptions,
      abortSignal: input.signal,
    });

    logRuntimeModelDebug("generate.succeeded", {
      providerID: preparedCall.providerID,
      providerModelID: preparedCall.providerModelID,
      ...input,
    });
    return result;
  } catch (error) {
    logRuntimeModelError("generate.failed", error, input);
    if (isRuntimeRpcError(error)) throw error;
    if (
      providerID &&
      error instanceof Error &&
      (APICallError.isInstance(error) || RetryError.isInstance(error))
    ) {
      throw wrapProviderError(error, providerID, "generate");
    }
    throw wrapExtensionError(error, "model.generate");
  }
}

export async function runLanguageModelStream(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
  signal?: AbortSignal;
}): Promise<ReadableStream<LanguageModelV3StreamPart>> {
  logRuntimeModelDebug("stream.started", input);

  let providerID: string | undefined;

  try {
    const preparedCall = await prepareRuntimeLanguageModelCall(input);
    providerID = preparedCall.providerID;

    const result = await preparedCall.languageModel.doStream({
      ...preparedCall.callOptions,
      abortSignal: input.signal,
    });

    logRuntimeModelDebug("stream.succeeded", {
      providerID: preparedCall.providerID,
      providerModelID: preparedCall.providerModelID,
      ...input,
    });
    return result.stream;
  } catch (error) {
    logRuntimeModelError("stream.failed", error, input);
    if (isRuntimeRpcError(error)) throw error;
    if (
      providerID &&
      error instanceof Error &&
      (APICallError.isInstance(error) || RetryError.isInstance(error))
    ) {
      throw wrapProviderError(error, providerID, "stream");
    }
    throw wrapExtensionError(error, "model.stream");
  }
}
