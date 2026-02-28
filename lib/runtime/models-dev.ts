import snapshotData from "@/lib/runtime/models-snapshot.json";
import { MODELS_REFRESH_TIMEOUT_MS } from "@/lib/runtime/constants";
import { runtimeDb } from "@/lib/runtime/db/runtime-db";
import { runTx } from "@/lib/runtime/db/runtime-db-tx";
import type { ModelsDevModel, ModelsDevProvider } from "@/lib/runtime/types";
import { isObject } from "@/lib/runtime/util";

const DEFAULT_MODELS_URL = "https://models.dev/api.json";
const MODELS_CACHE_KEY = "modelsCacheData";
const MODELS_CACHE_UPDATED_AT_KEY = "modelsCacheUpdatedAt";

function normalizeModels(input: unknown): Record<string, ModelsDevModel> {
  if (!isObject(input)) return {};

  const out: Record<string, ModelsDevModel> = {};
  for (const [modelID, rawModel] of Object.entries(input)) {
    if (!isObject(rawModel)) continue;
    out[modelID] = {
      ...rawModel,
      id: typeof rawModel.id === "string" ? rawModel.id : modelID,
      name: typeof rawModel.name === "string" ? rawModel.name : modelID,
      limit: isObject(rawModel.limit)
        ? {
            context:
              typeof rawModel.limit.context === "number"
                ? rawModel.limit.context
                : 0,
            input:
              typeof rawModel.limit.input === "number"
                ? rawModel.limit.input
                : undefined,
            output:
              typeof rawModel.limit.output === "number"
                ? rawModel.limit.output
                : 0,
          }
        : { context: 0, output: 0 },
      release_date:
        typeof rawModel.release_date === "string" ? rawModel.release_date : "",
      attachment: Boolean(rawModel.attachment),
      reasoning: Boolean(rawModel.reasoning),
      temperature: Boolean(rawModel.temperature),
      tool_call:
        rawModel.tool_call === undefined ? true : Boolean(rawModel.tool_call),
    };
  }
  return out;
}

function normalizeProviders(input: unknown): Record<string, ModelsDevProvider> {
  if (!isObject(input)) return {};
  const out: Record<string, ModelsDevProvider> = {};
  for (const [providerID, rawProvider] of Object.entries(input)) {
    if (!isObject(rawProvider)) continue;
    const models = normalizeModels(rawProvider.models);
    out[providerID] = {
      id: typeof rawProvider.id === "string" ? rawProvider.id : providerID,
      name:
        typeof rawProvider.name === "string" ? rawProvider.name : providerID,
      env: Array.isArray(rawProvider.env)
        ? rawProvider.env.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      api: typeof rawProvider.api === "string" ? rawProvider.api : undefined,
      npm: typeof rawProvider.npm === "string" ? rawProvider.npm : undefined,
      models,
    };
  }
  return out;
}

export async function getModelsDevUpdatedAt() {
  const updated = await runtimeDb.meta.get(MODELS_CACHE_UPDATED_AT_KEY);
  return typeof updated?.value === "number" ? updated.value : 0;
}

export async function getModelsDevData() {
  const cached = await runtimeDb.meta.get(MODELS_CACHE_KEY);
  if (
    cached?.value &&
    isObject(cached.value) &&
    Object.keys(cached.value).length > 0
  ) {
    return normalizeProviders(cached.value);
  }

  return normalizeProviders(snapshotData);
}

async function setModelsDevCache(
  data: Record<string, ModelsDevProvider>,
  updatedAt: number,
) {
  await runTx([runtimeDb.meta], async () => {
    await runtimeDb.meta.put({
      key: MODELS_CACHE_KEY,
      value: data,
      updatedAt,
    });

    await runtimeDb.meta.put({
      key: MODELS_CACHE_UPDATED_AT_KEY,
      value: updatedAt,
      updatedAt,
    });
  });
}

export async function refreshModelsDevData(options?: { url?: string }) {
  const url = options?.url ?? DEFAULT_MODELS_URL;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok)
    throw new Error(`Failed to fetch models.dev: ${response.status}`);

  const parsed = normalizeProviders(await response.json());
  await setModelsDevCache(parsed, Date.now());
  return parsed;
}
