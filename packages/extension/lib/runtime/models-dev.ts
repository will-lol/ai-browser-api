import snapshotData from "@/lib/runtime/models-snapshot.json";
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

export async function getModelsDevData() {
  return normalizeProviders(snapshotData);
}
