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
import * as Schema from "effect/Schema";
import { parseProviderOptions } from "./provider-options";
import { defineAuthSchema } from "./schema";
import type {
  AIAdapter,
  AdapterAuthContext,
  AuthMethodDefinition,
  RuntimeAdapterContext,
} from "./types";
import type {
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/background/runtime/provider-registry";

const baseProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

const openAICompatibleProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  queryParams: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.String,
    }),
  ),
  includeUsage: Schema.optional(Schema.Boolean),
  supportsStructuredOutputs: Schema.optional(Schema.Boolean),
});

const openAIProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  organization: Schema.optional(Schema.String),
  project: Schema.optional(Schema.String),
});

const azureProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  apiVersion: Schema.optional(Schema.String),
  resourceName: Schema.optional(Schema.String),
  useDeploymentBasedUrls: Schema.optional(Schema.Boolean),
});

const bedrockProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  region: Schema.optional(Schema.String),
  accessKeyId: Schema.optional(Schema.String),
  secretAccessKey: Schema.optional(Schema.String),
  sessionToken: Schema.optional(Schema.String),
});

const gatewayProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  metadataCacheRefreshMillis: Schema.optional(Schema.Number),
});

type BaseProviderOptions = Schema.Schema.Type<typeof baseProviderOptionsSchema>;
type OpenAICompatibleProviderOptions = Schema.Schema.Type<
  typeof openAICompatibleProviderOptionsSchema
>;
type OpenAIProviderOptions = Schema.Schema.Type<
  typeof openAIProviderOptionsSchema
>;
type AzureProviderOptions = Schema.Schema.Type<
  typeof azureProviderOptionsSchema
>;
type BedrockProviderOptions = Schema.Schema.Type<
  typeof bedrockProviderOptionsSchema
>;
type GatewayProviderOptions = Schema.Schema.Type<
  typeof gatewayProviderOptionsSchema
>;

type AdapterModelContext<TProviderOptions extends Record<string, unknown>> = {
  provider: ProviderRuntimeInfo;
  providerOptions: TProviderOptions;
  model: ProviderModelInfo;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

type ApiKeyProviderDescriptor<
  TProviderOptions extends Record<string, unknown>,
> = {
  key: string;
  displayName: string;
  npm: string;
  browserSupported?: boolean;
  providerOptionsSchema: Schema.Schema<
    TProviderOptions,
    TProviderOptions,
    never
  >;
  createLanguageModel?: (
    input: AdapterModelContext<TProviderOptions>,
  ) => LanguageModelV3 | Promise<LanguageModelV3>;
};

const requiredAuthStringSchema = Schema.String.pipe(Schema.minLength(1));

function apiKeyLabel(ctx: AdapterAuthContext) {
  return ctx.provider.env[0] ?? `${ctx.providerID.toUpperCase()}_API_KEY`;
}

function resolveBaseURL(
  input: AdapterModelContext<BaseProviderOptions>,
  options?: {
    fallbackToModelURL?: boolean;
  },
) {
  return (
    input.baseURL ??
    input.providerOptions.baseURL ??
    (options?.fallbackToModelURL ? input.model.api.url : undefined)
  );
}

function mergeHeaders(input: AdapterModelContext<Record<string, unknown>>) {
  return {
    ...input.model.headers,
    ...(input.headers ?? {}),
  };
}

function buildOpenAICompatibleSettings(
  input: AdapterModelContext<OpenAICompatibleProviderOptions>,
): Parameters<typeof createOpenAICompatible>[0] {
  return {
    baseURL:
      resolveBaseURL(input, { fallbackToModelURL: true }) ??
      input.model.api.url,
    name: input.providerOptions.name ?? input.provider.id,
    apiKey: input.apiKey,
    headers: mergeHeaders(input),
    queryParams: input.providerOptions.queryParams,
    fetch: input.fetch,
    includeUsage: input.providerOptions.includeUsage,
    supportsStructuredOutputs: input.providerOptions.supportsStructuredOutputs,
  };
}

function buildOpenAISettings(
  input: AdapterModelContext<OpenAIProviderOptions>,
): Parameters<typeof createOpenAI>[0] {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: input.apiKey,
    headers: mergeHeaders(input),
    name: input.providerOptions.name ?? input.provider.id,
    organization: input.providerOptions.organization,
    project: input.providerOptions.project,
    fetch: input.fetch,
  };
}

function buildAnthropicSettings(
  input: AdapterModelContext<BaseProviderOptions>,
): Parameters<typeof createAnthropic>[0] {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: input.apiKey,
    headers: mergeHeaders(input),
    name: input.providerOptions.name ?? input.provider.id,
    fetch: input.fetch,
  };
}

function buildGoogleSettings(
  input: AdapterModelContext<BaseProviderOptions>,
): Parameters<typeof createGoogleGenerativeAI>[0] {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: input.apiKey,
    headers: mergeHeaders(input),
    name: input.providerOptions.name ?? input.provider.id,
    fetch: input.fetch,
  };
}

function buildAzureSettings(
  input: AdapterModelContext<AzureProviderOptions>,
): Parameters<typeof createAzure>[0] {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: input.apiKey,
    headers: mergeHeaders(input),
    fetch: input.fetch,
    apiVersion: input.providerOptions.apiVersion,
    resourceName: input.providerOptions.resourceName,
    useDeploymentBasedUrls: input.providerOptions.useDeploymentBasedUrls,
  };
}

function buildApiKeySettings(input: AdapterModelContext<BaseProviderOptions>) {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: input.apiKey,
    headers: mergeHeaders(input),
    fetch: input.fetch,
  };
}

function buildBedrockSettings(
  input: AdapterModelContext<BedrockProviderOptions>,
): Parameters<typeof createAmazonBedrock>[0] {
  return {
    ...buildApiKeySettings(input),
    region: input.providerOptions.region,
    accessKeyId: input.providerOptions.accessKeyId,
    secretAccessKey: input.providerOptions.secretAccessKey,
    sessionToken: input.providerOptions.sessionToken,
  };
}

function buildGatewaySettings(
  input: AdapterModelContext<GatewayProviderOptions>,
): Parameters<typeof createGateway>[0] {
  return {
    ...buildApiKeySettings(input),
    metadataCacheRefreshMillis:
      input.providerOptions.metadataCacheRefreshMillis,
  };
}

export function createApiKeyMethod(
  ctx: AdapterAuthContext,
): AuthMethodDefinition<Record<string, string | undefined>> {
  return {
    id: "apikey",
    type: "apikey",
    label: "API Key",
    inputSchema: defineAuthSchema({
      apiKey: {
        schema: requiredAuthStringSchema,
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
        key: input.values.apiKey ?? "",
        methodID: "apikey",
        methodType: "apikey",
      };
    },
  };
}

function createUnsupportedModelError(npm: string) {
  return new Error(
    `Provider SDK package is not supported in browser runtime: ${npm}`,
  );
}

function resolveApiKey(context: RuntimeAdapterContext) {
  return context.auth?.type === "api" ? context.auth.key : undefined;
}

function createDirectFactoryAdapter<
  TProviderOptions extends Record<string, unknown>,
>(descriptor: ApiKeyProviderDescriptor<TProviderOptions>): AIAdapter {
  return {
    key: descriptor.key,
    displayName: descriptor.displayName,
    match: {
      npm: descriptor.npm,
    },
    listAuthMethods(ctx) {
      return [createApiKeyMethod(ctx)];
    },
    async createModel(context) {
      if (
        descriptor.browserSupported === false ||
        !descriptor.createLanguageModel
      ) {
        throw createUnsupportedModelError(context.model.api.npm);
      }

      return descriptor.createLanguageModel({
        provider: context.provider,
        providerOptions: parseProviderOptions(
          descriptor.providerOptionsSchema,
          context.provider.options,
        ),
        model: context.model,
        apiKey: resolveApiKey(context),
      });
    },
  };
}

const apiKeyProviderDescriptors = [
  {
    key: "@ai-sdk/openai-compatible",
    displayName: "OpenAI Compatible",
    npm: "@ai-sdk/openai-compatible",
    providerOptionsSchema: openAICompatibleProviderOptionsSchema,
    createLanguageModel(input) {
      return createOpenAICompatible(
        buildOpenAICompatibleSettings(input),
      ).languageModel(input.model.api.id);
    },
  },
  {
    key: "@ai-sdk/openai",
    displayName: "OpenAI",
    npm: "@ai-sdk/openai",
    providerOptionsSchema: openAIProviderOptionsSchema,
    createLanguageModel(input) {
      return createOpenAI(buildOpenAISettings(input)).responses(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/anthropic",
    displayName: "Anthropic",
    npm: "@ai-sdk/anthropic",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createAnthropic(buildAnthropicSettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/google",
    displayName: "Google",
    npm: "@ai-sdk/google",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createGoogleGenerativeAI(buildGoogleSettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/azure",
    displayName: "Azure",
    npm: "@ai-sdk/azure",
    providerOptionsSchema: azureProviderOptionsSchema,
    createLanguageModel(input) {
      return createAzure(buildAzureSettings(input)).responses(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/amazon-bedrock",
    displayName: "Amazon Bedrock",
    npm: "@ai-sdk/amazon-bedrock",
    providerOptionsSchema: bedrockProviderOptionsSchema,
    createLanguageModel(input) {
      return createAmazonBedrock(buildBedrockSettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/cerebras",
    displayName: "Cerebras",
    npm: "@ai-sdk/cerebras",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createCerebras(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/cohere",
    displayName: "Cohere",
    npm: "@ai-sdk/cohere",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createCohere(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/deepinfra",
    displayName: "DeepInfra",
    npm: "@ai-sdk/deepinfra",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createDeepInfra(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/gateway",
    displayName: "Gateway",
    npm: "@ai-sdk/gateway",
    providerOptionsSchema: gatewayProviderOptionsSchema,
    createLanguageModel(input) {
      return createGateway(buildGatewaySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/groq",
    displayName: "Groq",
    npm: "@ai-sdk/groq",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createGroq(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/mistral",
    displayName: "Mistral",
    npm: "@ai-sdk/mistral",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createMistral(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/perplexity",
    displayName: "Perplexity",
    npm: "@ai-sdk/perplexity",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createPerplexity(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/togetherai",
    displayName: "Together AI",
    npm: "@ai-sdk/togetherai",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createTogetherAI(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/vercel",
    displayName: "Vercel",
    npm: "@ai-sdk/vercel",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createVercel(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@ai-sdk/xai",
    displayName: "xAI",
    npm: "@ai-sdk/xai",
    providerOptionsSchema: baseProviderOptionsSchema,
    createLanguageModel(input) {
      return createXai(buildApiKeySettings(input)).languageModel(
        input.model.api.id,
      );
    },
  },
  {
    key: "@openrouter/ai-sdk-provider",
    displayName: "OpenRouter",
    npm: "@openrouter/ai-sdk-provider",
    providerOptionsSchema: baseProviderOptionsSchema,
    browserSupported: false,
  },
  {
    key: "@ai-sdk/google-vertex",
    displayName: "Google Vertex",
    npm: "@ai-sdk/google-vertex",
    providerOptionsSchema: baseProviderOptionsSchema,
    browserSupported: false,
  },
  {
    key: "@ai-sdk/google-vertex/anthropic",
    displayName: "Google Vertex Anthropic",
    npm: "@ai-sdk/google-vertex/anthropic",
    providerOptionsSchema: baseProviderOptionsSchema,
    browserSupported: false,
  },
] satisfies ReadonlyArray<ApiKeyProviderDescriptor<Record<string, unknown>>>;

export const genericFactoryAdapters = Object.fromEntries(
  apiKeyProviderDescriptors.map((descriptor) => [
    descriptor.key,
    createDirectFactoryAdapter(descriptor),
  ]),
) as Record<string, AIAdapter>;
