import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createCerebras } from "@ai-sdk/cerebras";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createVercel } from "@ai-sdk/vercel";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type {
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/lib/runtime/provider-registry";
import { isObject } from "@/lib/runtime/util";
import type { RuntimeTransportConfig } from "./types";

function coerceFactoryOptions<TFactory extends (options?: any) => any>(
  factory: TFactory,
) {
  return (options: Record<string, unknown>) =>
    factory(options as NonNullable<Parameters<TFactory>[0]>);
}

const PROVIDER_FACTORIES = {
  "@ai-sdk/amazon-bedrock": coerceFactoryOptions(createAmazonBedrock),
  "@ai-sdk/anthropic": coerceFactoryOptions(createAnthropic),
  "@ai-sdk/azure": coerceFactoryOptions(createAzure),
  "@ai-sdk/cerebras": coerceFactoryOptions(createCerebras),
  "@ai-sdk/cohere": coerceFactoryOptions(createCohere),
  "@ai-sdk/deepinfra": coerceFactoryOptions(createDeepInfra),
  "@ai-sdk/gateway": coerceFactoryOptions(createGateway),
  "@ai-sdk/google": coerceFactoryOptions(createGoogleGenerativeAI),
  "@ai-sdk/groq": coerceFactoryOptions(createGroq),
  "@ai-sdk/mistral": coerceFactoryOptions(createMistral),
  "@ai-sdk/openai": coerceFactoryOptions(createOpenAI),
  "@ai-sdk/openai-compatible": coerceFactoryOptions(createOpenAICompatible),
  "@ai-sdk/perplexity": coerceFactoryOptions(createPerplexity),
  "@ai-sdk/togetherai": coerceFactoryOptions(createTogetherAI),
  "@ai-sdk/vercel": coerceFactoryOptions(createVercel),
  "@ai-sdk/xai": coerceFactoryOptions(createXai),
  "@openrouter/ai-sdk-provider": coerceFactoryOptions(createOpenRouter),
} as const;

export type SupportedFactoryNpm = keyof typeof PROVIDER_FACTORIES;

type ProviderFactory = (typeof PROVIDER_FACTORIES)[SupportedFactoryNpm];
type AnyProvider = ReturnType<ProviderFactory>;

type InvocationPreference = "languageModel" | "responses" | "chat";

function isObjectRecord(value: unknown) {
  return isObject(value);
}

function toHeaderRecord(value: unknown) {
  if (!isObjectRecord(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") continue;
    headers[key] = item;
  }
  return headers;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isAnthropicPackage(npm: string) {
  return (
    npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic"
  );
}

function isGooglePackage(npm: string) {
  return npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex";
}

export function normalizeFactoryNpm(npm: string): SupportedFactoryNpm {
  if (npm in PROVIDER_FACTORIES) {
    return npm as SupportedFactoryNpm;
  }

  if (
    npm === "ai-gateway-provider" ||
    npm === "venice-ai-sdk-provider" ||
    npm === "@jerome-benoit/sap-ai-provider-v2" ||
    npm.includes("openai-compatible") ||
    npm === "@ai-sdk/github-copilot"
  ) {
    return "@ai-sdk/openai-compatible";
  }

  if (
    npm === "@gitlab/gitlab-ai-provider" ||
    npm === "@ai-sdk/google-vertex" ||
    npm === "@ai-sdk/google-vertex/anthropic"
  ) {
    throw new Error(
      `Provider SDK package is not supported in browser runtime: ${npm}`,
    );
  }

  throw new Error(`Unsupported provider SDK package: ${npm}`);
}

function buildProviderOptions(input: {
  provider: ProviderRuntimeInfo;
  model: ProviderModelInfo;
  transport: RuntimeTransportConfig;
  staticHeaders?: Record<string, string>;
  npm: string;
}) {
  const authHeaders: Record<string, string> = {};

  if (input.transport.apiKey && input.transport.authType === "api-key") {
    authHeaders["x-api-key"] = input.transport.apiKey;
  }

  if (input.transport.apiKey && input.transport.authType === "bearer") {
    authHeaders.authorization = `Bearer ${input.transport.apiKey}`;
  }

  if (input.transport.apiKey && isAnthropicPackage(input.npm)) {
    authHeaders["x-api-key"] = input.transport.apiKey;
    authHeaders["anthropic-version"] = "2023-06-01";
  }

  if (
    input.transport.apiKey &&
    isGooglePackage(input.npm) &&
    input.transport.authType !== "bearer"
  ) {
    authHeaders["x-goog-api-key"] = input.transport.apiKey;
  }

  const options: Record<string, unknown> = {
    name: input.provider.id,
    ...input.provider.options,
    ...input.model.options,
    headers: {
      ...input.model.headers,
      ...input.transport.headers,
      ...authHeaders,
      ...(input.staticHeaders ?? {}),
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
    !(isGooglePackage(input.npm) && input.transport.authType === "bearer")
  ) {
    options.apiKey = input.transport.apiKey;
  }

  return options;
}

function createProviderSdk(input: {
  npm: SupportedFactoryNpm;
  options: Record<string, unknown>;
}) {
  return PROVIDER_FACTORIES[input.npm](input.options) as AnyProvider;
}

function pickInvocation(input: {
  sdk: AnyProvider;
  modelID: string;
  sourceNpm: string;
  resolvedNpm: SupportedFactoryNpm;
  preferred?: InvocationPreference;
}) {
  const order = (() => {
    if (input.preferred) {
      return [input.preferred, "responses", "chat", "languageModel"];
    }

    if (
      input.resolvedNpm === "@ai-sdk/openai" ||
      input.resolvedNpm === "@ai-sdk/azure" ||
      input.sourceNpm === "@ai-sdk/github-copilot"
    ) {
      return ["responses", "chat", "languageModel"];
    }

    return ["languageModel", "responses", "chat"];
  })();

  for (const invocation of order) {
    if (
      invocation === "responses" &&
      "responses" in input.sdk &&
      typeof input.sdk.responses === "function"
    ) {
      return input.sdk.responses(input.modelID) as LanguageModelV3;
    }

    if (
      invocation === "chat" &&
      "chat" in input.sdk &&
      typeof input.sdk.chat === "function"
    ) {
      return input.sdk.chat(input.modelID) as LanguageModelV3;
    }

    if (
      invocation === "languageModel" &&
      "languageModel" in input.sdk &&
      typeof input.sdk.languageModel === "function"
    ) {
      return input.sdk.languageModel(input.modelID) as LanguageModelV3;
    }
  }

  throw new Error(`Failed to create language model for ${input.modelID}`);
}

export function normalizeTransport(
  input: Partial<RuntimeTransportConfig>,
): RuntimeTransportConfig {
  return {
    baseURL: readString(input.baseURL),
    apiKey: readString(input.apiKey),
    authType: input.authType,
    headers: toHeaderRecord(input.headers),
    fetch: typeof input.fetch === "function" ? input.fetch : undefined,
  };
}

export function mergeTransport(
  ...patches: Array<Partial<RuntimeTransportConfig> | undefined>
): RuntimeTransportConfig {
  let next: RuntimeTransportConfig = {
    headers: {},
  };

  for (const patch of patches) {
    if (!patch) continue;
    const normalized = normalizeTransport(patch);
    next = {
      ...next,
      ...normalized,
      headers: {
        ...next.headers,
        ...normalized.headers,
      },
    };
  }

  return next;
}

export function mergeModelHeaders(
  options: LanguageModelV3CallOptions,
  patch: Record<string, string>,
): LanguageModelV3CallOptions {
  return {
    ...options,
    headers: {
      ...toHeaderRecord(options.headers),
      ...patch,
    },
  };
}

export function mergeModelProviderOptions(
  options: LanguageModelV3CallOptions,
  providerKey: string,
  patch: Record<string, unknown>,
): LanguageModelV3CallOptions {
  const providerOptions = isObjectRecord(options.providerOptions)
    ? (options.providerOptions as Record<string, unknown>)
    : {};
  const current = isObjectRecord(providerOptions[providerKey])
    ? (providerOptions[providerKey] as Record<string, unknown>)
    : {};

  return {
    ...options,
    providerOptions: {
      ...providerOptions,
      [providerKey]: {
        ...current,
        ...patch,
      },
    } as LanguageModelV3CallOptions["providerOptions"],
  };
}

export async function createFactoryLanguageModel(input: {
  provider: ProviderRuntimeInfo;
  model: ProviderModelInfo;
  transport: RuntimeTransportConfig;
  npm?: string;
  staticHeaders?: Record<string, string>;
  staticOptions?: Record<string, unknown>;
  preferredInvocation?: InvocationPreference;
}) {
  const sourceNpm = input.npm ?? input.model.api.npm;
  const resolvedNpm = normalizeFactoryNpm(sourceNpm);
  const providerOptions = buildProviderOptions({
    provider: input.provider,
    model: input.model,
    transport: input.transport,
    staticHeaders: input.staticHeaders,
    npm: sourceNpm,
  });
  const finalOptions = {
    ...providerOptions,
    ...(input.staticOptions ?? {}),
  };

  const sdk = createProviderSdk({
    npm: resolvedNpm,
    options: finalOptions,
  });

  return pickInvocation({
    sdk,
    modelID: input.model.api.id,
    sourceNpm,
    resolvedNpm,
    preferred: input.preferredInvocation,
  });
}
