import snapshotData from "@/lib/runtime/models-snapshot.json";
import { runtimeDb } from "@/lib/runtime/db/runtime-db";
import { runTx } from "@/lib/runtime/db/runtime-db-tx";
import { MODELS_DEV_API_URL } from "@/lib/runtime/constants";
import { isObject } from "@/lib/runtime/util";

export interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  release_date: string;
  attachment: boolean;
  reasoning: boolean;
  temperature: boolean;
  tool_call: boolean;
  interleaved?: boolean | { field: "reasoning_content" | "reasoning_details" };
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
  limit: {
    context: number;
    input?: number;
    output: number;
  };
  modalities?: {
    input: Array<"text" | "audio" | "image" | "video" | "pdf">;
    output: Array<"text" | "audio" | "image" | "video" | "pdf">;
  };
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
  provider?: {
    npm?: string;
    api?: string;
  };
  status?: "alpha" | "beta" | "deprecated";
  variants?: Record<string, Record<string, unknown>>;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  env: string[];
  api?: string;
  npm?: string;
  models: Record<string, ModelsDevModel>;
}

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
    } as ModelsDevModel;
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
  const url = options?.url ?? MODELS_DEV_API_URL;

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
