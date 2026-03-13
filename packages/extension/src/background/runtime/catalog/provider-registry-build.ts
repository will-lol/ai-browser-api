import * as Effect from "effect/Effect";
import type { AuthRecord } from "@/background/runtime/auth/auth-store";
import { listAuth } from "@/background/runtime/auth/auth-store";
import { getRuntimeConfig } from "@/background/runtime/config/config-store";
import type { RuntimeProviderConfig } from "@/background/runtime/config/config-store";
import { getModelCapabilities, mergeRecord } from "@/background/runtime/core/util";
import { resolveAdapterForProvider } from "@/background/runtime/providers/adapters";
import type {
  ModelsDevModel,
  ModelsDevProvider,
} from "@/background/runtime/catalog/models-dev";
import { runtimeModelKey } from "@/background/storage/runtime-db-types";
import type {
  ProviderInfo,
  ProviderModelInfo,
} from "./provider-registry-types";

type RuntimeModelOverrides = NonNullable<RuntimeProviderConfig["models"]>;
type RuntimeModelOverride = RuntimeModelOverrides[string];

function toCapabilities(model: ModelsDevModel) {
  return {
    temperature: Boolean(model.temperature),
    reasoning: Boolean(model.reasoning),
    attachment: Boolean(model.attachment),
    toolcall: model.tool_call ?? true,
    input: {
      text: model.modalities?.input?.includes("text") ?? true,
      audio: model.modalities?.input?.includes("audio") ?? false,
      image: model.modalities?.input?.includes("image") ?? false,
      video: model.modalities?.input?.includes("video") ?? false,
      pdf: model.modalities?.input?.includes("pdf") ?? false,
    },
    output: {
      text: model.modalities?.output?.includes("text") ?? true,
      audio: model.modalities?.output?.includes("audio") ?? false,
      image: model.modalities?.output?.includes("image") ?? false,
      video: model.modalities?.output?.includes("video") ?? false,
      pdf: model.modalities?.output?.includes("pdf") ?? false,
    },
  };
}

function toProviderModel(
  provider: ModelsDevProvider,
  modelID: string,
  model: ModelsDevModel,
): ProviderModelInfo {
  const id =
    typeof model.id === "string" && model.id.length > 0 ? model.id : modelID;
  const name =
    typeof model.name === "string" && model.name.length > 0 ? model.name : id;

  return {
    id,
    providerID: provider.id,
    name,
    family: model.family,
    status: model.status ?? "active",
    release_date: model.release_date,
    api: {
      id,
      url: model.provider?.api ?? provider.api ?? "",
      npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
    },
    cost: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cache: {
        read: model.cost?.cache_read ?? 0,
        write: model.cost?.cache_write ?? 0,
      },
    },
    limit: {
      context: model.limit?.context ?? 0,
      input: model.limit?.input,
      output: model.limit?.output ?? 0,
    },
    headers: model.headers ?? {},
    options: model.options ?? {},
    capabilities: toCapabilities(model),
    variants: model.variants,
  };
}

function mergeModelConfig(
  base: ProviderModelInfo,
  override?: RuntimeModelOverride,
) {
  if (!override) return base;
  return {
    ...base,
    name: override.name ?? base.name,
    family: override.family ?? base.family,
    status:
      (override.status as ProviderModelInfo["status"] | undefined) ??
      base.status,
    release_date: override.release_date ?? base.release_date,
    api: {
      ...base.api,
      id: override.id ?? base.api.id,
      url: override.provider?.api ?? base.api.url,
      npm: override.provider?.npm ?? base.api.npm,
    },
    headers: mergeRecord(base.headers, override.headers),
    options: mergeRecord(base.options, override.options),
    variants: {
      ...(base.variants ?? {}),
      ...(override.variants ?? {}),
    },
  };
}

function applyModelFilters(
  providerID: string,
  models: Record<string, ProviderModelInfo>,
  config?: RuntimeProviderConfig,
) {
  const whitelist = new Set(config?.whitelist ?? []);
  const blacklist = new Set(config?.blacklist ?? []);
  const useWhitelist = whitelist.size > 0;

  const out: Record<string, ProviderModelInfo> = {};

  for (const [modelID, model] of Object.entries(models)) {
    if (model.status === "deprecated" || model.status === "alpha") continue;
    if (blacklist.has(modelID)) continue;
    if (useWhitelist && !whitelist.has(modelID)) continue;

    const override = config?.models?.[modelID];
    if (override?.disabled) continue;

    out[modelID] = mergeModelConfig(model, override);
  }

  for (const [modelID, model] of Object.entries(config?.models ?? {})) {
    if (out[modelID]) continue;
    if (model.disabled) continue;

    out[modelID] = {
      id: modelID,
      providerID,
      name: model.name ?? modelID,
      family: model.family,
      status:
        (model.status as ProviderModelInfo["status"] | undefined) ?? "active",
      release_date: model.release_date,
      api: {
        id: model.id ?? modelID,
        npm: model.provider?.npm ?? "@ai-sdk/openai-compatible",
        url: model.provider?.api ?? config?.options?.baseURL?.toString() ?? "",
      },
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: {
          read: model.cost?.cache_read ?? 0,
          write: model.cost?.cache_write ?? 0,
        },
      },
      limit: {
        context: model.limit?.context ?? 0,
        input: model.limit?.input,
        output: model.limit?.output ?? 0,
      },
      headers: model.headers ?? {},
      options: model.options ?? {},
      capabilities: {
        temperature: model.temperature ?? false,
        reasoning: model.reasoning ?? false,
        attachment: model.attachment ?? false,
        toolcall: model.tool_call ?? true,
        input: {
          text: model.modalities?.input?.includes("text") ?? true,
          audio: model.modalities?.input?.includes("audio") ?? false,
          image: model.modalities?.input?.includes("image") ?? false,
          video: model.modalities?.input?.includes("video") ?? false,
          pdf: model.modalities?.input?.includes("pdf") ?? false,
        },
        output: {
          text: model.modalities?.output?.includes("text") ?? true,
          audio: model.modalities?.output?.includes("audio") ?? false,
          image: model.modalities?.output?.includes("image") ?? false,
          video: model.modalities?.output?.includes("video") ?? false,
          pdf: model.modalities?.output?.includes("pdf") ?? false,
        },
      },
      variants: model.variants,
    };
  }

  return out;
}

export function providerToRows(provider: ProviderInfo, updatedAt: number) {
  const models = Object.values(provider.models).map((model) => ({
    id: runtimeModelKey(provider.id, model.id),
    providerID: provider.id,
    capabilities: getModelCapabilities(runtimeModelKey(provider.id, model.id)),
    info: model,
    updatedAt,
  }));

  return {
    providerRow: {
      id: provider.id,
      name: provider.name,
      source: provider.source,
      env: provider.env,
      connected: provider.connected,
      options: provider.options,
      modelCount: models.length,
      updatedAt,
    },
    modelRows: models,
  };
}

export function buildProviderFromSource(input: {
  providerID: string;
  source: ModelsDevProvider;
  config?: RuntimeProviderConfig;
  authMap: Record<string, AuthRecord | undefined>;
}) {
  const models = applyModelFilters(
    input.providerID,
    Object.fromEntries(
      Object.entries(input.source.models).map(([modelID, model]) => [
        modelID,
        toProviderModel(input.source, modelID, model),
      ]),
    ),
    input.config,
  );

  if (Object.keys(models).length === 0) {
    return Effect.succeed(undefined);
  }

  const provider: ProviderInfo = {
    id: input.providerID,
    name: input.config?.name ?? input.source.name,
    source: input.config ? "config" : "models.dev",
    env: [...(input.config?.env ?? input.source.env)],
    connected: Boolean(input.authMap[input.providerID]),
    options: mergeRecord({}, input.config?.options ?? {}),
    models,
  };

  const auth = input.authMap[input.providerID];
  const adapter = resolveAdapterForProvider({
    providerID: input.providerID,
    source: input.source,
  });
  const patchCatalog = adapter?.patchCatalog;
  if (!patchCatalog) {
    return Effect.succeed(provider);
  }

  return Effect.promise(() =>
    Promise.resolve(
      patchCatalog(
        {
          providerID: input.providerID,
          provider,
          auth,
        },
        provider,
      ),
    ),
  ).pipe(Effect.map((patched) => patched ?? provider));
}

export function loadProviderCatalogInputs() {
  return Effect.all([
    Effect.promise(() => getRuntimeConfig()),
    listAuth(),
  ]);
}
