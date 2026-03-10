import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { APICallError } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import { fromRuntimeModelCallOptions } from "@llm-bridge/bridge-codecs";
import {
  ModelNotFoundError,
  ProviderNotConnectedError,
  RuntimeValidationError,
  isRuntimeRpcError,
  type RuntimeChatCallOptions,
  type RuntimeModelCallOptions,
} from "@llm-bridge/contracts";
import { RetryError } from "ai";
import type { AuthRecord } from "@/lib/runtime/auth-store";
import { getAuth, removeAuth, setAuth } from "@/lib/runtime/auth-store";
import { resolveAdapterForModel } from "@/lib/runtime/adapters";
import { wrapExtensionError, wrapProviderError } from "@/lib/runtime/errors";
import type { RuntimeAdapterContext } from "@/lib/runtime/adapters/types";
import { getModel, getProvider } from "@/lib/runtime/provider-registry";
import type {
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/lib/runtime/provider-registry";
import { isObject, parseProviderModel } from "@/lib/runtime/util";

export type RuntimeLanguageModelCallOptions = Omit<
  LanguageModelV3CallOptions,
  "abortSignal"
>;

interface ModelRuntimeContext {
  providerID: string;
  modelID: string;
  provider: ProviderRuntimeInfo;
  model: ProviderModelInfo;
  auth?: AuthRecord;
}

type PreparedCallOptions = {
  callOptions: RuntimeLanguageModelCallOptions;
  context: RuntimeAdapterContext;
  languageModel: LanguageModelV3;
};

type PreparedRuntimeLanguageModelCall = {
  providerID: string;
  providerModelID: string;
  languageModel: LanguageModelV3;
  callOptions: RuntimeLanguageModelCallOptions;
};

export type PreparedRuntimeChatModelCall = {
  providerID: string;
  providerModelID: string;
  languageModel: LanguageModelV3;
  callOptions: Omit<RuntimeLanguageModelCallOptions, "prompt">;
};

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

function toHeaderRecord(value: unknown) {
  if (!isObject(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") continue;
    headers[key] = item;
  }
  return headers;
}

function toRuntimeModelCallOptionsForChat(
  options?: RuntimeChatCallOptions,
): RuntimeModelCallOptions {
  return {
    prompt: [],
    maxOutputTokens: options?.maxOutputTokens,
    temperature: options?.temperature,
    stopSequences: options?.stopSequences
      ? [...options.stopSequences]
      : undefined,
    topP: options?.topP,
    topK: options?.topK,
    presencePenalty: options?.presencePenalty,
    frequencyPenalty: options?.frequencyPenalty,
    responseFormat: options?.responseFormat,
    seed: options?.seed,
    tools: options?.tools ? [...options.tools] : undefined,
    toolChoice: options?.toolChoice,
    includeRawChunks: options?.includeRawChunks,
    headers: options?.headers ? { ...options.headers } : undefined,
    providerOptions: options?.providerOptions
      ? { ...options.providerOptions }
      : undefined,
  };
}

function normalizeCallOptions(
  options: Partial<RuntimeLanguageModelCallOptions> | undefined,
  fallback: RuntimeLanguageModelCallOptions,
): RuntimeLanguageModelCallOptions {
  const callOptions: RuntimeLanguageModelCallOptions = {
    ...fallback,
  };

  if (options?.prompt) {
    callOptions.prompt = options.prompt;
  }

  if (typeof options?.maxOutputTokens === "number") {
    callOptions.maxOutputTokens = options.maxOutputTokens;
  }

  if (typeof options?.temperature === "number") {
    callOptions.temperature = options.temperature;
  }
  if (typeof options?.topP === "number") {
    callOptions.topP = options.topP;
  }
  if (typeof options?.topK === "number") {
    callOptions.topK = options.topK;
  }
  if (typeof options?.presencePenalty === "number") {
    callOptions.presencePenalty = options.presencePenalty;
  }
  if (typeof options?.frequencyPenalty === "number") {
    callOptions.frequencyPenalty = options.frequencyPenalty;
  }

  if (options?.stopSequences) {
    callOptions.stopSequences = [...options.stopSequences];
  }

  if (options?.responseFormat !== undefined) {
    callOptions.responseFormat = options.responseFormat;
  }

  if (typeof options?.seed === "number") {
    callOptions.seed = options.seed;
  }

  if (options?.tools) {
    callOptions.tools = [...options.tools];
  }

  if (options?.toolChoice !== undefined) {
    callOptions.toolChoice = options.toolChoice;
  }

  if (typeof options?.includeRawChunks === "boolean") {
    callOptions.includeRawChunks = options.includeRawChunks;
  }

  if (options?.providerOptions) {
    callOptions.providerOptions = {
      ...options.providerOptions,
    };
  }

  callOptions.headers = toHeaderRecord(options?.headers);

  return callOptions;
}

async function resolveModelRuntimeContext(
  modelID: string,
): Promise<ModelRuntimeContext> {
  const parsed = parseProviderModel(modelID);
  if (!parsed.providerID || !parsed.modelID) {
    throw new RuntimeValidationError({
      message: `Invalid model: ${modelID}`,
    });
  }

  const [provider, model, auth] = await Promise.all([
    getProvider(parsed.providerID),
    getModel(parsed.providerID, parsed.modelID),
    getAuth(parsed.providerID),
  ]);

  if (!provider || !model) {
    throw new ModelNotFoundError({
      modelId: modelID,
      message: `Model not found: ${modelID}`,
    });
  }

  if (!auth) {
    throw new ProviderNotConnectedError({
      providerID: parsed.providerID,
      message: `Provider ${parsed.providerID} is not connected`,
    });
  }

  return {
    providerID: parsed.providerID,
    modelID: parsed.modelID,
    provider,
    model,
    auth,
  };
}

function buildAdapterContext(input: {
  runtime: ModelRuntimeContext;
  origin: string;
  sessionID: string;
  requestID: string;
}): RuntimeAdapterContext {
  const adapter = resolveAdapterForModel({
    providerID: input.runtime.providerID,
    model: input.runtime.model,
  });

  if (!adapter) {
    throw new Error(
      `No adapter is registered for provider ${input.runtime.providerID} (${input.runtime.model.api.npm})`,
    );
  }

  return {
    providerID: input.runtime.providerID,
    modelID: input.runtime.modelID,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    auth: input.runtime.auth,
    provider: input.runtime.provider,
    model: input.runtime.model,
    authStore: {
      get: () => getAuth(input.runtime.providerID),
      set: async (auth) => {
        await setAuth(input.runtime.providerID, auth);
      },
      remove: () => removeAuth(input.runtime.providerID),
    },
    runtime: {
      now: () => Date.now(),
    },
  };
}

async function prepareCallOptions(input: {
  runtime: ModelRuntimeContext;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
}) {
  const adapter = resolveAdapterForModel({
    providerID: input.runtime.providerID,
    model: input.runtime.model,
  });
  if (!adapter) {
    throw new Error(
      `No adapter is registered for provider ${input.runtime.providerID} (${input.runtime.model.api.npm})`,
    );
  }

  const context = buildAdapterContext({
    runtime: input.runtime,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
  });
  const languageModel = await adapter.createModel(context);
  const callOptions = normalizeCallOptions(input.options, {
    ...input.options,
    headers: toHeaderRecord(input.options.headers),
  });

  return {
    prepared: {
      callOptions,
      context,
      languageModel,
    } satisfies PreparedCallOptions,
  };
}

async function prepareRuntimeLanguageModelCall(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
}): Promise<PreparedRuntimeLanguageModelCall> {
  const runtime = await resolveModelRuntimeContext(input.modelID);
  const { prepared } = await prepareCallOptions({
    runtime,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    options: input.options,
  });

  return {
    providerID: runtime.providerID,
    providerModelID: runtime.modelID,
    languageModel: prepared.languageModel,
    callOptions: prepared.callOptions,
  };
}

export async function prepareRuntimeChatModelCall(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  messages: Array<ModelMessage>;
  options?: RuntimeChatCallOptions;
}): Promise<PreparedRuntimeChatModelCall> {
  const runtime = await resolveModelRuntimeContext(input.modelID);
  const adapter = resolveAdapterForModel({
    providerID: runtime.providerID,
    model: runtime.model,
  });
  if (!adapter) {
    throw new Error(
      `No adapter is registered for provider ${runtime.providerID} (${runtime.model.api.npm})`,
    );
  }
  const context = buildAdapterContext({
    runtime,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
  });

  const fallback = fromRuntimeModelCallOptions(
    toRuntimeModelCallOptionsForChat(input.options),
  );

  const callOptions = normalizeCallOptions(fallback, fallback);

  const languageModel = await adapter.createModel(context);

  const { prompt: _prompt, ...callOptionsWithoutPrompt } = callOptions;

  return {
    providerID: runtime.providerID,
    providerModelID: runtime.modelID,
    languageModel,
    callOptions: callOptionsWithoutPrompt,
  };
}

export async function getRuntimeModelDescriptor(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
}) {
  let providerID: string | undefined;

  try {
    const runtime = await resolveModelRuntimeContext(input.modelID);
    providerID = runtime.providerID;

    const { prepared } = await prepareCallOptions({
      runtime,
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
      },
    });

    const supportedUrls = await Promise.resolve(
      prepared.languageModel.supportedUrls ?? {},
    );

    return {
      provider: prepared.languageModel.provider,
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
  logRuntimeModelDebug("generate.started", {
    modelID: input.modelID,
    origin: input.origin,
    requestID: input.requestID,
    sessionID: input.sessionID,
  });

  let providerID: string | undefined;

  try {
    const preparedCall = await prepareRuntimeLanguageModelCall({
      modelID: input.modelID,
      origin: input.origin,
      sessionID: input.sessionID,
      requestID: input.requestID,
      options: input.options,
    });
    providerID = preparedCall.providerID;
    const result = await preparedCall.languageModel.doGenerate({
      ...preparedCall.callOptions,
      abortSignal: input.signal,
    });

    logRuntimeModelDebug("generate.succeeded", {
      modelID: input.modelID,
      origin: input.origin,
      requestID: input.requestID,
      sessionID: input.sessionID,
      providerID: preparedCall.providerID,
      providerModelID: preparedCall.providerModelID,
    });
    return result;
  } catch (error) {
    logRuntimeModelError("generate.failed", error, {
      modelID: input.modelID,
      origin: input.origin,
      requestID: input.requestID,
      sessionID: input.sessionID,
    });
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
  logRuntimeModelDebug("stream.started", {
    modelID: input.modelID,
    origin: input.origin,
    requestID: input.requestID,
    sessionID: input.sessionID,
  });

  let providerID: string | undefined;

  try {
    const preparedCall = await prepareRuntimeLanguageModelCall({
      modelID: input.modelID,
      origin: input.origin,
      sessionID: input.sessionID,
      requestID: input.requestID,
      options: input.options,
    });
    providerID = preparedCall.providerID;
    const result = await preparedCall.languageModel.doStream({
      ...preparedCall.callOptions,
      abortSignal: input.signal,
    });

    logRuntimeModelDebug("stream.succeeded", {
      modelID: input.modelID,
      origin: input.origin,
      requestID: input.requestID,
      sessionID: input.sessionID,
      providerID: preparedCall.providerID,
      providerModelID: preparedCall.providerModelID,
    });
    return result.stream;
  } catch (error) {
    logRuntimeModelError("stream.failed", error, {
      modelID: input.modelID,
      origin: input.origin,
      requestID: input.requestID,
      sessionID: input.sessionID,
    });
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
