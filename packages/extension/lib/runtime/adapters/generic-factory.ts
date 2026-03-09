import type { LanguageModelV3 } from "@ai-sdk/provider";
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
import { z } from "zod";
import { defineAuthSchema } from "./schema";
import type {
  AIAdapter,
  AdapterAuthContext,
  AuthMethodDefinition,
  ParsedAuthRecord,
  RuntimeTransportConfig,
} from "./types";
import type {
  AuthRecord,
  AuthResult,
} from "@/lib/runtime/auth-store";
import type {
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/lib/runtime/provider-registry";

type AdapterModelContext = {
  provider: ProviderRuntimeInfo;
  model: ProviderModelInfo;
  transport: RuntimeTransportConfig;
};

function apiKeyLabel(ctx: AdapterAuthContext) {
  return ctx.provider.env[0] ?? `${ctx.providerID.toUpperCase()}_API_KEY`;
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") continue;
    output[key] = entry;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function resolveBaseURL(input: AdapterModelContext, options?: {
  fallbackToModelURL?: boolean;
}) {
  return (
    readString(input.transport.baseURL) ??
    readString(input.provider.options.baseURL) ??
    (options?.fallbackToModelURL ? readString(input.model.api.url) : undefined)
  );
}

function mergeHeaders(input: AdapterModelContext) {
  return {
    ...input.model.headers,
    ...input.transport.headers,
  };
}

function buildOpenAICompatibleSettings(
  input: AdapterModelContext,
): Parameters<typeof createOpenAICompatible>[0] {
  return {
    baseURL:
      resolveBaseURL(input, { fallbackToModelURL: true }) ?? input.model.api.url,
    name: readString(input.provider.options.name) ?? input.provider.id,
    apiKey: readString(input.transport.apiKey),
    headers: mergeHeaders(input),
    queryParams: readStringRecord(input.provider.options.queryParams),
    fetch: input.transport.fetch,
    includeUsage: readBoolean(input.provider.options.includeUsage),
    supportsStructuredOutputs: readBoolean(
      input.provider.options.supportsStructuredOutputs,
    ),
  };
}

function buildOpenAISettings(
  input: AdapterModelContext,
): Parameters<typeof createOpenAI>[0] {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: readString(input.transport.apiKey),
    headers: mergeHeaders(input),
    name: readString(input.provider.options.name) ?? input.provider.id,
    organization: readString(input.provider.options.organization),
    project: readString(input.provider.options.project),
    fetch: input.transport.fetch,
  };
}

function buildAnthropicSettings(
  input: AdapterModelContext,
): Parameters<typeof createAnthropic>[0] {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: readString(input.transport.apiKey),
    headers: mergeHeaders(input),
    name: readString(input.provider.options.name) ?? input.provider.id,
    fetch: input.transport.fetch,
  };
}

function buildGoogleSettings(
  input: AdapterModelContext,
): Parameters<typeof createGoogleGenerativeAI>[0] {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: readString(input.transport.apiKey),
    headers: mergeHeaders(input),
    name: readString(input.provider.options.name) ?? input.provider.id,
    fetch: input.transport.fetch,
  };
}

function buildAzureSettings(
  input: AdapterModelContext,
): Parameters<typeof createAzure>[0] {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: readString(input.transport.apiKey),
    headers: mergeHeaders(input),
    fetch: input.transport.fetch,
    apiVersion: readString(input.provider.options.apiVersion),
    resourceName: readString(input.provider.options.resourceName),
    useDeploymentBasedUrls: readBoolean(
      input.provider.options.useDeploymentBasedUrls,
    ),
  };
}

function buildApiKeySettings(input: AdapterModelContext) {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: readString(input.transport.apiKey),
    headers: mergeHeaders(input),
    fetch: input.transport.fetch,
  };
}

function buildBedrockSettings(
  input: AdapterModelContext,
): Parameters<typeof createAmazonBedrock>[0] {
  return {
    ...buildApiKeySettings(input),
    region: readString(input.provider.options.region),
    accessKeyId: readString(input.provider.options.accessKeyId),
    secretAccessKey: readString(input.provider.options.secretAccessKey),
    sessionToken: readString(input.provider.options.sessionToken),
  };
}

function buildGatewaySettings(
  input: AdapterModelContext,
): Parameters<typeof createGateway>[0] {
  return {
    ...buildApiKeySettings(input),
    metadataCacheRefreshMillis:
      typeof input.provider.options.metadataCacheRefreshMillis === "number"
        ? input.provider.options.metadataCacheRefreshMillis
        : undefined,
  };
}

type DirectFactoryAdapterInput = {
  key: string;
  displayName: string;
  npm: string;
  browserSupported?: boolean;
  createLanguageModel?: (
    input: AdapterModelContext,
  ) => LanguageModelV3 | Promise<LanguageModelV3>;
};

export function createApiKeyMethod(
  ctx: AdapterAuthContext,
): AuthMethodDefinition {
  return {
    id: "apikey",
    type: "apikey",
    label: "API Key",
    inputSchema: defineAuthSchema({
      apiKey: {
        schema: z.string().trim().min(1, "API key is required"),
        ui: {
          type: "secret",
          label: apiKeyLabel(ctx),
          placeholder: "Paste API key",
          required: true,
          description:
            "Stored by the extension using a browser-managed non-exportable key.",
        },
      },
    }),
    async authorize(input) {
      return {
        type: "api",
        key: input.values.apiKey,
        methodID: "apikey" as const,
        methodType: "apikey" as const,
      };
    },
  };
}

function parseGenericStoredAuth(
  auth?: AuthRecord,
): ParsedAuthRecord | undefined {
  if (!auth) return undefined;
  if (auth.type !== "api") return undefined;
  return auth;
}

function serializeGenericAuth(input: {
  result: AuthResult;
  method: Pick<AuthMethodDefinition, "id" | "type">;
}) {
  return input.result;
}

function createUnsupportedModelError(npm: string) {
  return new Error(`Provider SDK package is not supported in browser runtime: ${npm}`);
}

function createDirectFactoryAdapter(input: DirectFactoryAdapterInput) {
  const adapter: AIAdapter = {
    key: input.key,
    displayName: input.displayName,
    match: {
      npm: input.npm,
    },
    auth: {
      methods(ctx) {
        return [createApiKeyMethod(ctx)];
      },
      parseStoredAuth: parseGenericStoredAuth,
      serializeAuth: serializeGenericAuth,
      load(ctx) {
        if (ctx.auth?.type !== "api") {
          return {
            transport: {},
            state: undefined,
          };
        }

        return {
          transport: {
            apiKey: ctx.auth.key,
          },
          state: undefined,
        };
      },
    },
    async createModel({ context, transport }) {
      if (input.browserSupported === false || !input.createLanguageModel) {
        throw createUnsupportedModelError(context.model.api.npm);
      }

      return input.createLanguageModel({
        provider: context.provider,
        model: context.model,
        transport,
      });
    },
  };

  return adapter;
}

export const genericFactoryAdapters = {
  "@ai-sdk/openai-compatible": createDirectFactoryAdapter({
    key: "@ai-sdk/openai-compatible",
    displayName: "OpenAI Compatible",
    npm: "@ai-sdk/openai-compatible",
    createLanguageModel(input) {
      return createOpenAICompatible(
        buildOpenAICompatibleSettings(input),
      ).languageModel(input.model.api.id);
    },
  }),
  "@ai-sdk/openai": createDirectFactoryAdapter({
    key: "@ai-sdk/openai",
    displayName: "OpenAI",
    npm: "@ai-sdk/openai",
    createLanguageModel(input) {
      return createOpenAI(buildOpenAISettings(input)).responses(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/anthropic": createDirectFactoryAdapter({
    key: "@ai-sdk/anthropic",
    displayName: "Anthropic",
    npm: "@ai-sdk/anthropic",
    createLanguageModel(input) {
      return createAnthropic(buildAnthropicSettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/google": createDirectFactoryAdapter({
    key: "@ai-sdk/google",
    displayName: "Google",
    npm: "@ai-sdk/google",
    createLanguageModel(input) {
      return createGoogleGenerativeAI(buildGoogleSettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/azure": createDirectFactoryAdapter({
    key: "@ai-sdk/azure",
    displayName: "Azure",
    npm: "@ai-sdk/azure",
    createLanguageModel(input) {
      return createAzure(buildAzureSettings(input)).responses(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/amazon-bedrock": createDirectFactoryAdapter({
    key: "@ai-sdk/amazon-bedrock",
    displayName: "Amazon Bedrock",
    npm: "@ai-sdk/amazon-bedrock",
    createLanguageModel(input) {
      return createAmazonBedrock(buildBedrockSettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/cerebras": createDirectFactoryAdapter({
    key: "@ai-sdk/cerebras",
    displayName: "Cerebras",
    npm: "@ai-sdk/cerebras",
    createLanguageModel(input) {
      return createCerebras(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/cohere": createDirectFactoryAdapter({
    key: "@ai-sdk/cohere",
    displayName: "Cohere",
    npm: "@ai-sdk/cohere",
    createLanguageModel(input) {
      return createCohere(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/deepinfra": createDirectFactoryAdapter({
    key: "@ai-sdk/deepinfra",
    displayName: "DeepInfra",
    npm: "@ai-sdk/deepinfra",
    createLanguageModel(input) {
      return createDeepInfra(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/gateway": createDirectFactoryAdapter({
    key: "@ai-sdk/gateway",
    displayName: "Gateway",
    npm: "@ai-sdk/gateway",
    createLanguageModel(input) {
      return createGateway(buildGatewaySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/groq": createDirectFactoryAdapter({
    key: "@ai-sdk/groq",
    displayName: "Groq",
    npm: "@ai-sdk/groq",
    createLanguageModel(input) {
      return createGroq(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/mistral": createDirectFactoryAdapter({
    key: "@ai-sdk/mistral",
    displayName: "Mistral",
    npm: "@ai-sdk/mistral",
    createLanguageModel(input) {
      return createMistral(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/perplexity": createDirectFactoryAdapter({
    key: "@ai-sdk/perplexity",
    displayName: "Perplexity",
    npm: "@ai-sdk/perplexity",
    createLanguageModel(input) {
      return createPerplexity(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/togetherai": createDirectFactoryAdapter({
    key: "@ai-sdk/togetherai",
    displayName: "Together AI",
    npm: "@ai-sdk/togetherai",
    createLanguageModel(input) {
      return createTogetherAI(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/vercel": createDirectFactoryAdapter({
    key: "@ai-sdk/vercel",
    displayName: "Vercel",
    npm: "@ai-sdk/vercel",
    createLanguageModel(input) {
      return createVercel(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@ai-sdk/xai": createDirectFactoryAdapter({
    key: "@ai-sdk/xai",
    displayName: "xAI",
    npm: "@ai-sdk/xai",
    createLanguageModel(input) {
      return createXai(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  }),
  "@openrouter/ai-sdk-provider": createDirectFactoryAdapter({
    key: "@openrouter/ai-sdk-provider",
    displayName: "OpenRouter",
    npm: "@openrouter/ai-sdk-provider",
    browserSupported: false,
  }),
  "@ai-sdk/google-vertex": createDirectFactoryAdapter({
    key: "@ai-sdk/google-vertex",
    displayName: "Google Vertex",
    npm: "@ai-sdk/google-vertex",
    browserSupported: false,
  }),
  "@ai-sdk/google-vertex/anthropic": createDirectFactoryAdapter({
    key: "@ai-sdk/google-vertex/anthropic",
    displayName: "Google Vertex Anthropic",
    npm: "@ai-sdk/google-vertex/anthropic",
    browserSupported: false,
  }),
} as const;
