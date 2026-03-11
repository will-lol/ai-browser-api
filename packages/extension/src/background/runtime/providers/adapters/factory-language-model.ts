import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { isObject } from "@/background/runtime/core/util";

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

type SupportedFactoryNpm =
  | "@ai-sdk/amazon-bedrock"
  | "@ai-sdk/anthropic"
  | "@ai-sdk/azure"
  | "@ai-sdk/cerebras"
  | "@ai-sdk/cohere"
  | "@ai-sdk/deepinfra"
  | "@ai-sdk/gateway"
  | "@ai-sdk/google"
  | "@ai-sdk/groq"
  | "@ai-sdk/mistral"
  | "@ai-sdk/openai"
  | "@ai-sdk/openai-compatible"
  | "@ai-sdk/perplexity"
  | "@ai-sdk/togetherai"
  | "@ai-sdk/vercel"
  | "@ai-sdk/xai"
  | "@openrouter/ai-sdk-provider";

export function normalizeFactoryNpm(npm: string): SupportedFactoryNpm {
  if (
    npm === "@ai-sdk/amazon-bedrock" ||
    npm === "@ai-sdk/anthropic" ||
    npm === "@ai-sdk/azure" ||
    npm === "@ai-sdk/cerebras" ||
    npm === "@ai-sdk/cohere" ||
    npm === "@ai-sdk/deepinfra" ||
    npm === "@ai-sdk/gateway" ||
    npm === "@ai-sdk/google" ||
    npm === "@ai-sdk/groq" ||
    npm === "@ai-sdk/mistral" ||
    npm === "@ai-sdk/openai" ||
    npm === "@ai-sdk/openai-compatible" ||
    npm === "@ai-sdk/perplexity" ||
    npm === "@ai-sdk/togetherai" ||
    npm === "@ai-sdk/vercel" ||
    npm === "@ai-sdk/xai" ||
    npm === "@openrouter/ai-sdk-provider"
  ) {
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
