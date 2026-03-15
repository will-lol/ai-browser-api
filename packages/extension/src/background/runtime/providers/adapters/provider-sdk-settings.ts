import * as Schema from "effect/Schema";
import type {
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/background/runtime/catalog/provider-registry";

export const baseProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

export const openAICompatibleProviderOptionsSchema = Schema.Struct({
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

export const openAIProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  organization: Schema.optional(Schema.String),
  project: Schema.optional(Schema.String),
});

export type BaseProviderOptions = Schema.Schema.Type<
  typeof baseProviderOptionsSchema
>;
export type OpenAICompatibleProviderOptions = Schema.Schema.Type<
  typeof openAICompatibleProviderOptionsSchema
>;
export type OpenAIProviderOptions = Schema.Schema.Type<
  typeof openAIProviderOptionsSchema
>;

export type ProviderSdkSettingsInput<
  TProviderOptions extends Record<string, unknown>,
> = {
  provider: Pick<ProviderRuntimeInfo, "id">;
  model: Pick<ProviderModelInfo, "api" | "headers">;
  providerOptions: TProviderOptions;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

function resolveBaseURL(
  input: ProviderSdkSettingsInput<BaseProviderOptions>,
  options: {
    fallbackToModelURL?: boolean;
  } = {},
) {
  return (
    input.baseURL ??
    input.providerOptions.baseURL ??
    (options.fallbackToModelURL ? input.model.api.url : undefined)
  );
}

function mergeHeaders(
  input: ProviderSdkSettingsInput<Record<string, unknown>>,
) {
  return {
    ...input.model.headers,
    ...(input.headers ?? {}),
  };
}

export function buildOpenAICompatibleSettings(
  input: ProviderSdkSettingsInput<OpenAICompatibleProviderOptions>,
): {
  baseURL: string;
  name: string;
  apiKey?: string;
  headers: Record<string, string>;
  queryParams?: Record<string, string>;
  fetch?: typeof fetch;
  includeUsage?: boolean;
  supportsStructuredOutputs?: boolean;
} {
  return {
    baseURL:
      resolveBaseURL(input, {
        fallbackToModelURL: true,
      }) ?? input.model.api.url,
    name: input.providerOptions.name ?? input.provider.id,
    apiKey: input.apiKey,
    headers: mergeHeaders(input),
    queryParams: input.providerOptions.queryParams,
    fetch: input.fetch,
    includeUsage: input.providerOptions.includeUsage,
    supportsStructuredOutputs: input.providerOptions.supportsStructuredOutputs,
  };
}

export function buildOpenAISettings(
  input: ProviderSdkSettingsInput<OpenAIProviderOptions>,
): {
  baseURL?: string;
  apiKey?: string;
  headers: Record<string, string>;
  name: string;
  organization?: string;
  project?: string;
  fetch?: typeof fetch;
} {
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

export function buildGoogleSettings(
  input: ProviderSdkSettingsInput<BaseProviderOptions> & {
    oauthPlaceholderApiKey?: string;
  },
): {
  baseURL?: string;
  apiKey?: string;
  headers: Record<string, string>;
  name: string;
  fetch?: typeof fetch;
} {
  return {
    baseURL: resolveBaseURL(input),
    apiKey: input.apiKey ?? input.oauthPlaceholderApiKey,
    headers: mergeHeaders(input),
    name: input.providerOptions.name ?? input.provider.id,
    fetch: input.fetch,
  };
}
