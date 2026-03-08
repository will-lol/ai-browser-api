import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { APICallError } from "@ai-sdk/provider";
import type { ModelMessage } from "ai";
import { fromRuntimeModelCallOptions } from "@llm-bridge/bridge-codecs";
import * as amazonBedrockModule from "@ai-sdk/amazon-bedrock";
import * as anthropicModule from "@ai-sdk/anthropic";
import * as azureModule from "@ai-sdk/azure";
import * as cerebrasModule from "@ai-sdk/cerebras";
import * as cohereModule from "@ai-sdk/cohere";
import * as deepInfraModule from "@ai-sdk/deepinfra";
import * as gatewayModule from "@ai-sdk/gateway";
import * as googleModule from "@ai-sdk/google";
import * as groqModule from "@ai-sdk/groq";
import * as mistralModule from "@ai-sdk/mistral";
import * as openAIModule from "@ai-sdk/openai";
import * as openAICompatibleModule from "@ai-sdk/openai-compatible";
import * as perplexityModule from "@ai-sdk/perplexity";
import * as togetherAIModule from "@ai-sdk/togetherai";
import * as vercelModule from "@ai-sdk/vercel";
import * as xaiModule from "@ai-sdk/xai";
import {
  ModelNotFoundError,
  ProviderNotConnectedError,
  RuntimeValidationError,
  isRuntimeRpcError,
  type RuntimeChatCallOptions,
  type RuntimeModelCallOptions,
} from "@llm-bridge/contracts";
import * as openRouterModule from "@openrouter/ai-sdk-provider";
import { RetryError } from "ai";
import { getAuth } from "@/lib/runtime/auth-store";
import type { AuthRecord } from "@/lib/runtime/auth-store";
import { normalizeValueForCache } from "@/lib/runtime/ai/adapter-state";
import {
  wrapExtensionError,
  wrapProviderError,
} from "@/lib/runtime/errors";
import type {
  RuntimeAdapterContext,
  RuntimeAdapterState,
  RuntimeFactoryConfig,
  RuntimeProviderFactory,
  RuntimeTransportConfig,
} from "@/lib/runtime/plugin-manager";
import { getPluginManager } from "@/lib/runtime/plugins";
import { getModel, getProvider } from "@/lib/runtime/provider-registry";
import type {
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/lib/runtime/provider-registry";
import { isObject, mergeRecord, parseProviderModel } from "@/lib/runtime/util";

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
  transport: Partial<RuntimeTransportConfig>;
};

export type PreparedRuntimeLanguageModelCall = {
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

const providerSDKCache = new Map<string, ReturnType<RuntimeProviderFactory>>();
const languageModelCache = new Map<string, LanguageModelV3>();

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

function pickFactory(moduleValue: Record<string, unknown>) {
  const match = Object.entries(moduleValue).find(
    ([key, value]) => key.startsWith("create") && typeof value === "function",
  );
  if (!match) {
    throw new Error("Provider module does not export a factory function");
  }
  return match[1] as RuntimeProviderFactory;
}

const OPENAI_COMPATIBLE_FACTORY = pickFactory(
  openAICompatibleModule as unknown as Record<string, unknown>,
);

const PROVIDER_FACTORIES: Record<string, RuntimeProviderFactory> = {
  "@ai-sdk/amazon-bedrock": pickFactory(
    amazonBedrockModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/anthropic": pickFactory(
    anthropicModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/azure": pickFactory(
    azureModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/cerebras": pickFactory(
    cerebrasModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/cohere": pickFactory(
    cohereModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/deepinfra": pickFactory(
    deepInfraModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/gateway": pickFactory(
    gatewayModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/google": pickFactory(
    googleModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/groq": pickFactory(groqModule as unknown as Record<string, unknown>),
  "@ai-sdk/mistral": pickFactory(
    mistralModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/openai": pickFactory(
    openAIModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/openai-compatible": OPENAI_COMPATIBLE_FACTORY,
  "@ai-sdk/perplexity": pickFactory(
    perplexityModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/togetherai": pickFactory(
    togetherAIModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/vercel": pickFactory(
    vercelModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/xai": pickFactory(xaiModule as unknown as Record<string, unknown>),
  "@openrouter/ai-sdk-provider": pickFactory(
    openRouterModule as unknown as Record<string, unknown>,
  ),
};

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValueForCache(value));
}

function getProviderOptionKey(model: ProviderModelInfo) {
  switch (model.api.npm) {
    case "@ai-sdk/openai":
    case "@ai-sdk/azure":
      return "openai";
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return "anthropic";
    case "@ai-sdk/google":
    case "@ai-sdk/google-vertex":
      return "google";
    case "@ai-sdk/amazon-bedrock":
      return "bedrock";
    case "@openrouter/ai-sdk-provider":
      return "openrouter";
    case "@ai-sdk/gateway":
      return "gateway";
    case "@ai-sdk/github-copilot":
      return "copilot";
    default:
      return "openaiCompatible";
  }
}

function isAnthropicPackage(npm: string) {
  return (
    npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic"
  );
}

function isGooglePackage(npm: string) {
  return npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex";
}

function getFactoryForModel(model: ProviderModelInfo) {
  const direct = PROVIDER_FACTORIES[model.api.npm];
  if (direct) return direct;

  if (
    model.api.npm === "@gitlab/gitlab-ai-provider" ||
    model.api.npm === "@ai-sdk/google-vertex" ||
    model.api.npm === "@ai-sdk/google-vertex/anthropic"
  ) {
    throw new Error(
      `Provider SDK package is not supported in browser runtime: ${model.api.npm}`,
    );
  }

  if (model.api.npm === "@ai-sdk/github-copilot") {
    return OPENAI_COMPATIBLE_FACTORY;
  }

  if (
    model.api.npm === "ai-gateway-provider" ||
    model.api.npm === "venice-ai-sdk-provider" ||
    model.api.npm === "@jerome-benoit/sap-ai-provider-v2"
  ) {
    return OPENAI_COMPATIBLE_FACTORY;
  }

  if (model.api.npm.includes("openai-compatible")) {
    return OPENAI_COMPATIBLE_FACTORY;
  }

  throw new Error(`Unsupported provider SDK package: ${model.api.npm}`);
}

function resolveDefaultToken(auth?: AuthRecord) {
  if (!auth) return undefined;
  return auth.type === "api" ? auth.key : auth.access;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function toRecord(value: unknown) {
  if (!isObject(value)) return {};
  return value;
}

function normalizeTransport(
  input: Partial<RuntimeTransportConfig>,
): RuntimeTransportConfig {
  return {
    baseURL: readString(input.baseURL),
    apiKey: readString(input.apiKey),
    authType: input.authType,
    headers: toHeaderRecord(input.headers),
    metadata: toRecord(input.metadata),
    fetch: typeof input.fetch === "function" ? input.fetch : undefined,
  };
}

function toLegacyMessages(prompt: LanguageModelV3CallOptions["prompt"]) {
  return prompt.map((message) => {
    if (message.role === "system") {
      return {
        role: "system",
        content: message.content,
      };
    }

    return {
      role: message.role,
      content: message.content.map((part) => {
        if (part.type === "text") {
          return {
            type: "text",
            text: part.text,
          };
        }

        if (
          part.type === "file" &&
          part.mediaType.startsWith("image/") &&
          (typeof part.data === "string" || part.data instanceof URL)
        ) {
          return {
            type: "image_url",
            image_url: {
              url:
                typeof part.data === "string"
                  ? part.data
                  : part.data.toString(),
            },
          };
        }

        return part;
      }),
    };
  });
}

function toLegacyChatMessages(input: {
  messages: Array<ModelMessage>;
  system?: string;
}) {
  const systemMessages =
    input.system != null
      ? [
          {
            role: "system",
            content: input.system,
          },
        ]
      : [];

  const messages = input.messages.map((message) => {
    if (message.role === "system" && typeof message.content === "string") {
      return {
        role: message.role,
        content: message.content,
      };
    }

    if (message.role === "user") {
      if (typeof message.content === "string") {
        return {
          role: message.role,
          content: message.content,
        };
      }

      return {
        role: message.role,
        content: message.content.map((part) => {
          if (part.type === "text") {
            return {
              type: "text",
              text: part.text,
            };
          }

          if (
            part.type === "image" &&
            part.mediaType?.startsWith("image/") &&
            (typeof part.image === "string" || part.image instanceof URL)
          ) {
            return {
              type: "image_url",
              image_url: {
                url:
                  typeof part.image === "string"
                    ? part.image
                    : part.image.toString(),
              },
            };
          }

          if (
            part.type === "file" &&
            part.mediaType.startsWith("image/") &&
            (typeof part.data === "string" || part.data instanceof URL)
          ) {
            return {
              type: "image_url",
              image_url: {
                url:
                  typeof part.data === "string"
                    ? part.data
                    : part.data.toString(),
              },
            };
          }

          return part;
        }),
      };
    }

    if (message.role === "assistant" && typeof message.content === "string") {
      return {
        role: message.role,
        content: message.content,
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });

  return [...systemMessages, ...messages];
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

function toCallOptions(
  raw: Record<string, unknown>,
  fallback: RuntimeLanguageModelCallOptions,
): RuntimeLanguageModelCallOptions {
  const callOptions: RuntimeLanguageModelCallOptions = {
    ...fallback,
  };

  if (Array.isArray(raw.prompt)) {
    callOptions.prompt =
      raw.prompt as RuntimeLanguageModelCallOptions["prompt"];
  }

  if (typeof raw.maxOutputTokens === "number") {
    callOptions.maxOutputTokens = raw.maxOutputTokens;
  } else if (typeof raw.max_tokens === "number") {
    callOptions.maxOutputTokens = raw.max_tokens;
  }

  if (typeof raw.temperature === "number") {
    callOptions.temperature = raw.temperature;
  }
  if (typeof raw.topP === "number") {
    callOptions.topP = raw.topP;
  } else if (typeof raw.top_p === "number") {
    callOptions.topP = raw.top_p;
  }
  if (typeof raw.topK === "number") {
    callOptions.topK = raw.topK;
  }
  if (typeof raw.presencePenalty === "number") {
    callOptions.presencePenalty = raw.presencePenalty;
  }
  if (typeof raw.frequencyPenalty === "number") {
    callOptions.frequencyPenalty = raw.frequencyPenalty;
  }
  if (Array.isArray(raw.stopSequences)) {
    callOptions.stopSequences = raw.stopSequences.filter(
      (item): item is string => typeof item === "string",
    );
  } else if (Array.isArray(raw.stop)) {
    callOptions.stopSequences = raw.stop.filter(
      (item): item is string => typeof item === "string",
    );
  }

  if (isObject(raw.responseFormat)) {
    callOptions.responseFormat =
      raw.responseFormat as RuntimeLanguageModelCallOptions["responseFormat"];
  } else if (isObject(raw.response_format)) {
    callOptions.responseFormat =
      raw.response_format as RuntimeLanguageModelCallOptions["responseFormat"];
  }

  if (typeof raw.seed === "number") {
    callOptions.seed = raw.seed;
  }

  if (Array.isArray(raw.tools)) {
    callOptions.tools = raw.tools as RuntimeLanguageModelCallOptions["tools"];
  }

  if (typeof raw.toolChoice === "string" || isObject(raw.toolChoice)) {
    callOptions.toolChoice =
      raw.toolChoice as RuntimeLanguageModelCallOptions["toolChoice"];
  } else if (typeof raw.tool_choice === "string" || isObject(raw.tool_choice)) {
    callOptions.toolChoice =
      raw.tool_choice as RuntimeLanguageModelCallOptions["toolChoice"];
  }

  if (typeof raw.includeRawChunks === "boolean") {
    callOptions.includeRawChunks = raw.includeRawChunks;
  }

  if (isObject(raw.providerOptions)) {
    callOptions.providerOptions =
      raw.providerOptions as RuntimeLanguageModelCallOptions["providerOptions"];
  }

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

function buildBaseTransport(
  runtime: ModelRuntimeContext,
  patch: Partial<RuntimeTransportConfig>,
): RuntimeTransportConfig {
  const normalized = normalizeTransport(patch);

  return {
    ...normalized,
    baseURL: normalized.baseURL ?? readString(runtime.model.api.url),
    apiKey: normalized.apiKey ?? resolveDefaultToken(runtime.auth),
    headers: {
      ...normalized.headers,
    },
    metadata: mergeRecord({}, normalized.metadata),
  };
}

function buildFactoryOptions(input: {
  runtime: ModelRuntimeContext;
  transport: RuntimeTransportConfig;
  staticHeaders: Record<string, string>;
}) {
  const authHeaders: Record<string, string> = {};

  if (input.transport.apiKey && input.transport.authType === "api-key") {
    authHeaders["x-api-key"] = input.transport.apiKey;
  }

  if (input.transport.apiKey && input.transport.authType === "bearer") {
    authHeaders.authorization = `Bearer ${input.transport.apiKey}`;
  }

  if (
    input.transport.apiKey &&
    isAnthropicPackage(input.runtime.model.api.npm)
  ) {
    authHeaders["x-api-key"] = input.transport.apiKey;
    if (!("anthropic-version" in authHeaders)) {
      authHeaders["anthropic-version"] = "2023-06-01";
    }
  }

  if (
    input.transport.apiKey &&
    isGooglePackage(input.runtime.model.api.npm) &&
    input.transport.authType !== "bearer"
  ) {
    authHeaders["x-goog-api-key"] = input.transport.apiKey;
  }

  const options: Record<string, unknown> = {
    name: input.runtime.providerID,
    ...mergeRecord(
      mergeRecord(
        {},
        input.runtime.provider.options as Record<string, unknown>,
      ),
      input.runtime.model.options as Record<string, unknown>,
    ),
    headers: {
      ...input.runtime.model.headers,
      ...input.transport.headers,
      ...authHeaders,
      ...input.staticHeaders,
    },
  };

  if (input.transport.baseURL) {
    options.baseURL = input.transport.baseURL;
  }

  if (input.transport.fetch) {
    options.fetch = input.transport.fetch;
  }

  if (
    input.transport.apiKey &&
    !(
      isGooglePackage(input.runtime.model.api.npm) &&
      input.transport.authType === "bearer"
    )
  ) {
    options.apiKey = input.transport.apiKey;
  }

  return options;
}

async function getLanguageModel(input: {
  runtime: ModelRuntimeContext;
  context: RuntimeAdapterContext;
  transportPatch: Partial<RuntimeTransportConfig>;
  staticHeaders: Record<string, string>;
}) {
  const plugins = getPluginManager();

  const initialState: RuntimeAdapterState = {
    factory: {
      npm: input.runtime.model.api.npm,
      factory: getFactoryForModel(input.runtime.model),
    } satisfies RuntimeFactoryConfig,
    transport: buildBaseTransport(input.runtime, input.transportPatch),
    cacheKeyParts: {},
  };

  const adapted = await plugins.applyAdapterState(input.context, initialState);

  let factoryOptions = buildFactoryOptions({
    runtime: input.runtime,
    transport: adapted.transport,
    staticHeaders: input.staticHeaders,
  });

  factoryOptions = await plugins.applyAdapterFactoryOptions(
    input.context,
    factoryOptions,
  );

  await plugins.validateAdapterState(input.context, {
    ...adapted,
    factoryOptions,
  });

  const sdkCacheKey = stableStringify({
    providerID: input.runtime.providerID,
    npm: adapted.factory.npm,
    options: factoryOptions,
    adapter: adapted.cacheKeyParts,
  });

  let sdk = providerSDKCache.get(sdkCacheKey);
  if (!sdk) {
    sdk = adapted.factory.factory(factoryOptions);
    providerSDKCache.set(sdkCacheKey, sdk);
  }

  const modelCacheKey = `${sdkCacheKey}:${input.runtime.model.api.id}`;
  const existingModel = languageModelCache.get(modelCacheKey);
  if (existingModel) return existingModel;

  const languageModel = (() => {
    if (
      adapted.factory.npm === "@ai-sdk/openai" ||
      adapted.factory.npm === "@ai-sdk/azure"
    ) {
      const responses = sdk.responses;
      if (typeof responses === "function") {
        return responses(input.runtime.model.api.id);
      }
    }

    if (adapted.factory.npm === "@ai-sdk/github-copilot") {
      const responses = sdk.responses;
      if (typeof responses === "function") {
        return responses(input.runtime.model.api.id);
      }
      const chat = sdk.chat;
      if (typeof chat === "function") {
        return chat(input.runtime.model.api.id);
      }
    }

    return sdk.languageModel(input.runtime.model.api.id);
  })();

  languageModelCache.set(modelCacheKey, languageModel);
  return languageModel;
}

async function prepareCallOptions(input: {
  runtime: ModelRuntimeContext;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
}) {
  const plugins = getPluginManager();
  const context: RuntimeAdapterContext = {
    providerID: input.runtime.providerID,
    modelID: input.runtime.modelID,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    auth: input.runtime.auth,
    provider: input.runtime.provider,
    model: input.runtime.model,
  };

  const authOptions = await plugins.loadAuthOptions({
    providerID: input.runtime.providerID,
    provider: input.runtime.provider,
    auth: input.runtime.auth,
  });

  const merged = mergeRecord(
    mergeRecord(input.options as Record<string, unknown>, {
      model: input.runtime.model.api.id,
      messages: toLegacyMessages(input.options.prompt),
    }),
    authOptions.requestOptions,
  );

  const chatPatched = await plugins.applyChatParams(context, merged);
  const requestPatched = await plugins.applyRequestOptions(
    context,
    chatPatched,
  );

  const finalHeaders = await plugins.applyChatHeaders(context, {
    ...toHeaderRecord(input.options.headers),
    ...toHeaderRecord(requestPatched.headers),
  });

  const providerOptionKey = getProviderOptionKey(input.runtime.model);
  const knownKeys = new Set([
    "prompt",
    "maxOutputTokens",
    "max_tokens",
    "temperature",
    "stopSequences",
    "stop",
    "topP",
    "top_p",
    "topK",
    "presencePenalty",
    "frequencyPenalty",
    "responseFormat",
    "response_format",
    "seed",
    "tools",
    "toolChoice",
    "tool_choice",
    "includeRawChunks",
    "providerOptions",
    "headers",
    "model",
    "messages",
  ]);

  const providerOptionsPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(requestPatched)) {
    if (knownKeys.has(key)) continue;
    if (value === undefined) continue;
    providerOptionsPatch[key] = value;
  }

  const callOptions = toCallOptions(requestPatched, input.options);
  if (Object.keys(providerOptionsPatch).length > 0) {
    callOptions.providerOptions = mergeRecord(
      (callOptions.providerOptions as Record<string, unknown>) ?? {},
      {
        [providerOptionKey]: mergeRecord(
          ((callOptions.providerOptions as Record<string, unknown>)?.[
            providerOptionKey
          ] as Record<string, unknown> | undefined) ?? {},
          providerOptionsPatch,
        ),
      },
    ) as RuntimeLanguageModelCallOptions["providerOptions"];
  }

  callOptions.headers = finalHeaders;

  return {
    context,
    prepared: {
      callOptions,
      transport: authOptions.transport,
    } satisfies PreparedCallOptions,
  };
}

export async function prepareRuntimeLanguageModelCall(input: {
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  options: RuntimeLanguageModelCallOptions;
}): Promise<PreparedRuntimeLanguageModelCall> {
  const runtime = await resolveModelRuntimeContext(input.modelID);
  const { context, prepared } = await prepareCallOptions({
    runtime,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    options: input.options,
  });

  const languageModel = await getLanguageModel({
    runtime,
    context,
    transportPatch: prepared.transport,
    staticHeaders: toHeaderRecord(prepared.callOptions.headers),
  });

  return {
    providerID: runtime.providerID,
    providerModelID: runtime.modelID,
    languageModel,
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
  const plugins = getPluginManager();
  const context: RuntimeAdapterContext = {
    providerID: runtime.providerID,
    modelID: runtime.modelID,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    auth: runtime.auth,
    provider: runtime.provider,
    model: runtime.model,
  };

  const authOptions = await plugins.loadAuthOptions({
    providerID: runtime.providerID,
    provider: runtime.provider,
    auth: runtime.auth,
  });

  const merged = mergeRecord(
    mergeRecord(
      (input.options ?? {}) as Record<string, unknown>,
      {
        model: runtime.model.api.id,
        messages: toLegacyChatMessages({
          messages: input.messages,
          system: input.options?.system,
        }),
      },
    ),
    authOptions.requestOptions,
  );

  const chatPatched = await plugins.applyChatParams(context, merged);
  const requestPatched = await plugins.applyRequestOptions(context, chatPatched);
  const finalHeaders = await plugins.applyChatHeaders(context, {
    ...toHeaderRecord(input.options?.headers),
    ...toHeaderRecord(requestPatched.headers),
  });

  const providerOptionKey = getProviderOptionKey(runtime.model);
  const knownKeys = new Set([
    "prompt",
    "maxOutputTokens",
    "max_tokens",
    "temperature",
    "stopSequences",
    "stop",
    "topP",
    "top_p",
    "topK",
    "presencePenalty",
    "frequencyPenalty",
    "responseFormat",
    "response_format",
    "seed",
    "tools",
    "toolChoice",
    "tool_choice",
    "includeRawChunks",
    "providerOptions",
    "headers",
    "model",
    "messages",
    "system",
  ]);

  const providerOptionsPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(requestPatched)) {
    if (knownKeys.has(key)) continue;
    if (value === undefined) continue;
    providerOptionsPatch[key] = value;
  }

  const fallback = fromRuntimeModelCallOptions(
    toRuntimeModelCallOptionsForChat(input.options),
  );

  const callOptions = toCallOptions(requestPatched, fallback);

  if (Object.keys(providerOptionsPatch).length > 0) {
    callOptions.providerOptions = mergeRecord(
      (callOptions.providerOptions as Record<string, unknown>) ?? {},
      {
        [providerOptionKey]: mergeRecord(
          ((callOptions.providerOptions as Record<string, unknown>)?.[
            providerOptionKey
          ] as Record<string, unknown> | undefined) ?? {},
          providerOptionsPatch,
        ),
      },
    ) as RuntimeLanguageModelCallOptions["providerOptions"];
  }

  callOptions.headers = finalHeaders;

  const languageModel = await getLanguageModel({
    runtime,
    context,
    transportPatch: authOptions.transport,
    staticHeaders: toHeaderRecord(callOptions.headers),
  });

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

    const { context, prepared } = await prepareCallOptions({
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

    const languageModel = await getLanguageModel({
      runtime,
      context,
      transportPatch: prepared.transport,
      staticHeaders: toHeaderRecord(prepared.callOptions.headers),
    });
    const supportedUrls = await Promise.resolve(
      languageModel.supportedUrls ?? {},
    );

    return {
      provider: languageModel.provider,
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
