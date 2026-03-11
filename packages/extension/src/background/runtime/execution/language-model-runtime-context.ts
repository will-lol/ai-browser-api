import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import { fromRuntimeModelCallOptions } from "@llm-bridge/bridge-codecs";
import * as Effect from "effect/Effect";
import {
  ModelNotFoundError,
  ProviderNotConnectedError,
  RuntimeValidationError,
  type RuntimeChatCallOptions,
  type RuntimeModelCallOptions,
} from "@llm-bridge/contracts";
import type { AuthRecord } from "@/background/runtime/auth/auth-store";
import {
  getAuth,
  removeAuth,
  runSecurityEffect,
  setAuth,
} from "@/background/runtime/auth/auth-store";
import {
  getModel,
  getProvider,
} from "@/background/runtime/catalog/provider-registry";
import type {
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/background/runtime/catalog/provider-registry";
import { isObject, parseProviderModel } from "@/background/runtime/core/util";
import { resolveAdapterForModel } from "@/background/runtime/providers/adapters";
import type { RuntimeAdapterContext } from "@/background/runtime/providers/adapters/types";

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

function resolveModelRuntimeContext(
  modelID: string,
): Effect.Effect<
  ModelRuntimeContext,
  RuntimeValidationError | ModelNotFoundError | ProviderNotConnectedError
> {
  return Effect.gen(function* () {
    const parsed = parseProviderModel(modelID);
    if (!parsed.providerID || !parsed.modelID) {
      return yield* new RuntimeValidationError({
        message: `Invalid model: ${modelID}`,
      });
    }

    const [provider, model, auth] = yield* Effect.all([
      getProvider(parsed.providerID),
      getModel(parsed.providerID, parsed.modelID),
      Effect.promise(() => runSecurityEffect(getAuth(parsed.providerID))),
    ]);

    if (!provider || !model) {
      return yield* new ModelNotFoundError({
        modelId: modelID,
        message: `Model not found: ${modelID}`,
      });
    }

    if (!auth) {
      return yield* new ProviderNotConnectedError({
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
  });
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
      get: () => runSecurityEffect(getAuth(input.runtime.providerID)),
      set: (auth) =>
        runSecurityEffect(setAuth(input.runtime.providerID, auth)).then(
          () => undefined,
        ),
      remove: () =>
        runSecurityEffect(removeAuth(input.runtime.providerID)).then(
          () => undefined,
        ),
    },
    runtime: {
      now: () => Date.now(),
    },
  };
}

function prepareCallOptions(input: {
  runtime: ModelRuntimeContext;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
}) {
  return Effect.gen(function* () {
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
    const languageModel = yield* Effect.promise(() =>
      adapter.createModel(context),
    );
    const callOptions = {
      ...input.options,
      headers: toHeaderRecord(input.options.headers),
    };

    return {
      prepared: {
        callOptions,
        context,
        languageModel,
      } satisfies PreparedCallOptions,
    };
  });
}

export function prepareRuntimeLanguageModelCall(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
}) {
  return Effect.gen(function* () {
    const runtime = yield* resolveModelRuntimeContext(input.modelID);
    const { prepared } = yield* prepareCallOptions({
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
    } satisfies PreparedRuntimeLanguageModelCall;
  });
}

export function prepareRuntimeChatModelCall(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  messages: Array<ModelMessage>;
  options?: RuntimeChatCallOptions;
}) {
  return Effect.gen(function* () {
    const runtime = yield* resolveModelRuntimeContext(input.modelID);
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

    const callOptions = fromRuntimeModelCallOptions(
      toRuntimeModelCallOptionsForChat(input.options),
    );

    const languageModel = yield* Effect.promise(() =>
      adapter.createModel(context),
    );
    const { prompt: _prompt, ...callOptionsWithoutPrompt } = callOptions;

    return {
      providerID: runtime.providerID,
      providerModelID: runtime.modelID,
      languageModel,
      callOptions: callOptionsWithoutPrompt,
    } satisfies PreparedRuntimeChatModelCall;
  });
}
