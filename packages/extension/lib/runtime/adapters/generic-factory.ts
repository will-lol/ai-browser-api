import { z } from "zod";
import { createFactoryLanguageModel } from "./factory-language-model";
import { defineAuthSchema } from "./schema";
import type {
  AIAdapter,
  AdapterAuthContext,
  AuthMethodDefinition,
  ParsedAuthRecord,
} from "./types";
import type { AuthRecord, AuthResult } from "@/lib/runtime/auth-store";

function apiKeyLabel(ctx: AdapterAuthContext) {
  return ctx.provider.env[0] ?? `${ctx.providerID.toUpperCase()}_API_KEY`;
}

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

export function createGenericFactoryAdapter(input: {
  key: string;
  displayName: string;
  npm: string;
  browserSupported?: boolean;
}) {
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
      if (input.browserSupported === false) {
        throw createUnsupportedModelError(context.model.api.npm);
      }

      return createFactoryLanguageModel({
        provider: context.provider,
        model: context.model,
        transport,
      });
    },
  };

  return adapter;
}

export const genericFactoryAdapters = {
  "@ai-sdk/openai-compatible": createGenericFactoryAdapter({
    key: "@ai-sdk/openai-compatible",
    displayName: "OpenAI Compatible",
    npm: "@ai-sdk/openai-compatible",
  }),
  "@ai-sdk/openai": createGenericFactoryAdapter({
    key: "@ai-sdk/openai",
    displayName: "OpenAI",
    npm: "@ai-sdk/openai",
  }),
  "@ai-sdk/anthropic": createGenericFactoryAdapter({
    key: "@ai-sdk/anthropic",
    displayName: "Anthropic",
    npm: "@ai-sdk/anthropic",
  }),
  "@ai-sdk/google": createGenericFactoryAdapter({
    key: "@ai-sdk/google",
    displayName: "Google",
    npm: "@ai-sdk/google",
  }),
  "@ai-sdk/azure": createGenericFactoryAdapter({
    key: "@ai-sdk/azure",
    displayName: "Azure",
    npm: "@ai-sdk/azure",
  }),
  "@ai-sdk/amazon-bedrock": createGenericFactoryAdapter({
    key: "@ai-sdk/amazon-bedrock",
    displayName: "Amazon Bedrock",
    npm: "@ai-sdk/amazon-bedrock",
  }),
  "@ai-sdk/cerebras": createGenericFactoryAdapter({
    key: "@ai-sdk/cerebras",
    displayName: "Cerebras",
    npm: "@ai-sdk/cerebras",
  }),
  "@ai-sdk/cohere": createGenericFactoryAdapter({
    key: "@ai-sdk/cohere",
    displayName: "Cohere",
    npm: "@ai-sdk/cohere",
  }),
  "@ai-sdk/deepinfra": createGenericFactoryAdapter({
    key: "@ai-sdk/deepinfra",
    displayName: "DeepInfra",
    npm: "@ai-sdk/deepinfra",
  }),
  "@ai-sdk/gateway": createGenericFactoryAdapter({
    key: "@ai-sdk/gateway",
    displayName: "Gateway",
    npm: "@ai-sdk/gateway",
  }),
  "@ai-sdk/groq": createGenericFactoryAdapter({
    key: "@ai-sdk/groq",
    displayName: "Groq",
    npm: "@ai-sdk/groq",
  }),
  "@ai-sdk/mistral": createGenericFactoryAdapter({
    key: "@ai-sdk/mistral",
    displayName: "Mistral",
    npm: "@ai-sdk/mistral",
  }),
  "@ai-sdk/perplexity": createGenericFactoryAdapter({
    key: "@ai-sdk/perplexity",
    displayName: "Perplexity",
    npm: "@ai-sdk/perplexity",
  }),
  "@ai-sdk/togetherai": createGenericFactoryAdapter({
    key: "@ai-sdk/togetherai",
    displayName: "Together AI",
    npm: "@ai-sdk/togetherai",
  }),
  "@ai-sdk/vercel": createGenericFactoryAdapter({
    key: "@ai-sdk/vercel",
    displayName: "Vercel",
    npm: "@ai-sdk/vercel",
  }),
  "@ai-sdk/xai": createGenericFactoryAdapter({
    key: "@ai-sdk/xai",
    displayName: "xAI",
    npm: "@ai-sdk/xai",
  }),
  "@openrouter/ai-sdk-provider": createGenericFactoryAdapter({
    key: "@openrouter/ai-sdk-provider",
    displayName: "OpenRouter",
    npm: "@openrouter/ai-sdk-provider",
  }),
  "@ai-sdk/google-vertex": createGenericFactoryAdapter({
    key: "@ai-sdk/google-vertex",
    displayName: "Google Vertex",
    npm: "@ai-sdk/google-vertex",
    browserSupported: false,
  }),
  "@ai-sdk/google-vertex/anthropic": createGenericFactoryAdapter({
    key: "@ai-sdk/google-vertex/anthropic",
    displayName: "Google Vertex Anthropic",
    npm: "@ai-sdk/google-vertex/anthropic",
    browserSupported: false,
  }),
} as const;
