import { getRuntimeConfig } from "@/lib/runtime/config-store"
import { getModelsDevData } from "@/lib/runtime/models-dev"
import { getPluginManager } from "@/lib/runtime/plugins"
import {
  runtimeDb,
} from "@/lib/runtime/db/runtime-db"
import { runtimeModelKey } from "@/lib/runtime/db/runtime-db-types"
import { afterCommit, runTx } from "@/lib/runtime/db/runtime-db-tx"
import { listAuth, getAuth } from "@/lib/runtime/auth-store"
import { publishRuntimeEvent } from "@/lib/runtime/events/runtime-events"
import type {
  ModelsDevModel,
  ModelsDevProvider,
  ProviderInfo,
  ProviderModelInfo,
  RuntimeProviderConfig,
} from "@/lib/runtime/types"
import { getModelCapabilities, mergeRecord } from "@/lib/runtime/util"

type RuntimeModelOverrides = NonNullable<RuntimeProviderConfig["models"]>
type RuntimeModelOverride = RuntimeModelOverrides[string]

const CATALOG_UPDATED_AT_KEY = "catalogUpdatedAt"
const CATALOG_INITIALIZED_KEY = "catalogInitialized"

function toCapabilities(model: ModelsDevModel) {
  return {
    temperature: Boolean(model.temperature),
    reasoning: Boolean(model.reasoning),
    attachment: Boolean(model.attachment),
    toolcall: Boolean(model.tool_call),
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
  }
}

function toProviderModel(provider: ModelsDevProvider, model: ModelsDevModel): ProviderModelInfo {
  return {
    id: model.id,
    providerID: provider.id,
    name: model.name,
    family: model.family,
    status: model.status ?? "active",
    release_date: model.release_date,
    api: {
      id: model.id,
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
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    headers: model.headers ?? {},
    options: model.options ?? {},
    capabilities: toCapabilities(model),
    variants: model.variants,
  }
}

function mergeModelConfig(base: ProviderModelInfo, override?: RuntimeModelOverride) {
  if (!override) return base
  return {
    ...base,
    name: override.name ?? base.name,
    family: override.family ?? base.family,
    status: (override.status as ProviderModelInfo["status"] | undefined) ?? base.status,
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
  }
}

function applyModelFilters(providerID: string, models: Record<string, ProviderModelInfo>, config?: RuntimeProviderConfig) {
  const whitelist = new Set(config?.whitelist ?? [])
  const blacklist = new Set(config?.blacklist ?? [])
  const useWhitelist = whitelist.size > 0

  const out: Record<string, ProviderModelInfo> = {}

  for (const [modelID, model] of Object.entries(models)) {
    if (model.status === "deprecated") continue
    if (model.status === "alpha") continue
    if (blacklist.has(modelID)) continue
    if (useWhitelist && !whitelist.has(modelID)) continue

    const override = config?.models?.[modelID]
    if (override?.disabled) continue

    out[modelID] = mergeModelConfig(model, override)
  }

  for (const [modelID, model] of Object.entries(config?.models ?? {})) {
    if (out[modelID]) continue
    const fallback: ProviderModelInfo = {
      id: modelID,
      providerID,
      name: model.name ?? modelID,
      family: model.family,
      status: (model.status as ProviderModelInfo["status"] | undefined) ?? "active",
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
    }

    if (model.disabled) continue
    out[modelID] = fallback
  }

  return out
}

function providerToRows(provider: ProviderInfo, updatedAt: number) {
  const models = Object.values(provider.models).map((model) => ({
    id: runtimeModelKey(provider.id, model.id),
    providerID: provider.id,
    modelID: model.id,
    name: model.name,
    status: model.status,
    capabilities: getModelCapabilities(runtimeModelKey(provider.id, model.id)),
    info: model,
    updatedAt,
  }))

  const providerRow = {
    id: provider.id,
    name: provider.name,
    source: provider.source,
    env: provider.env,
    connected: provider.connected,
    options: provider.options,
    modelCount: models.length,
    updatedAt,
  }

  return {
    providerRow,
    modelRows: models,
  }
}

async function buildProviderFromSource(input: {
  providerID: string
  source: ModelsDevProvider
  config?: RuntimeProviderConfig
  authMap: Record<string, Awaited<ReturnType<typeof getAuth>>>
}) {
  const models = applyModelFilters(
    input.providerID,
    Object.fromEntries(
      Object.entries(input.source.models).map(([modelID, model]) => [
        modelID,
        toProviderModel(input.source, model),
      ]),
    ),
    input.config,
  )

  if (Object.keys(models).length === 0) {
    return undefined
  }

  const provider: ProviderInfo = {
    id: input.providerID,
    name: input.config?.name ?? input.source.name,
    source: input.config ? "config" : "models.dev",
    env: input.config?.env ?? input.source.env,
    connected: Boolean(input.authMap[input.providerID]),
    options: mergeRecord({}, input.config?.options ?? {}),
    models,
  }

  const pluginManager = getPluginManager()
  const auth = input.authMap[input.providerID]
  const patchedProvider = await pluginManager.patchProvider(
    { providerID: input.providerID, provider, auth },
    provider,
  )
  const patchedModels: Record<string, ProviderModelInfo> = {}
  for (const [modelID, model] of Object.entries(patchedProvider.models)) {
    patchedModels[modelID] = await pluginManager.patchModel(
      { providerID: input.providerID, provider: patchedProvider, auth },
      model,
    )
  }
  patchedProvider.models = patchedModels

  return patchedProvider
}

async function setCatalogInitialized(updatedAt: number) {
  await runtimeDb.meta.put({
    key: CATALOG_INITIALIZED_KEY,
    value: true,
    updatedAt,
  })
}

export async function isCatalogInitialized() {
  const value = await runtimeDb.meta.get(CATALOG_INITIALIZED_KEY)
  return value?.value === true
}

export async function refreshProviderCatalog() {
  const [modelsDev, authMap, config] = await Promise.all([
    getModelsDevData(),
    listAuth(),
    getRuntimeConfig(),
  ])

  const disabled = new Set(config.disabled_providers ?? [])
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

  const providers: ProviderInfo[] = []
  for (const [providerID, source] of Object.entries(modelsDev)) {
    if (disabled.has(providerID)) continue
    if (enabled && !enabled.has(providerID)) continue

    const provider = await buildProviderFromSource({
      providerID,
      source,
      config: config.provider?.[providerID],
      authMap,
    })
    if (provider) {
      providers.push(provider)
    }
  }

  const updatedAt = Date.now()
  const providerRows = providers.map((provider) => providerToRows(provider, updatedAt).providerRow)
  const modelRows = providers.flatMap((provider) => providerToRows(provider, updatedAt).modelRows)

  await runTx([runtimeDb.providers, runtimeDb.models, runtimeDb.meta], async () => {
    await runtimeDb.providers.clear()
    await runtimeDb.models.clear()

    if (providerRows.length > 0) {
      await runtimeDb.providers.bulkPut(providerRows)
    }
    if (modelRows.length > 0) {
      await runtimeDb.models.bulkPut(modelRows)
    }

    await runtimeDb.meta.put({
      key: CATALOG_UPDATED_AT_KEY,
      value: updatedAt,
      updatedAt,
    })
    await setCatalogInitialized(updatedAt)

    afterCommit(() => {
      publishRuntimeEvent({
        type: "runtime.catalog.refreshed",
        payload: { updatedAt },
      })
      publishRuntimeEvent({
        type: "runtime.providers.changed",
        payload: { providerIDs: providerRows.map((row) => row.id) },
      })
      publishRuntimeEvent({
        type: "runtime.models.changed",
        payload: { providerIDs: providerRows.map((row) => row.id) },
      })
    })
  })

  return updatedAt
}

export async function refreshProviderCatalogForProvider(providerID: string) {
  const [modelsDev, authMap, config] = await Promise.all([
    getModelsDevData(),
    listAuth(),
    getRuntimeConfig(),
  ])

  const updatedAt = Date.now()
  const source = modelsDev[providerID]

  const shouldInclude = (() => {
    if (!source) return false
    if (config.disabled_providers?.includes(providerID)) return false
    if (config.enabled_providers && !config.enabled_providers.includes(providerID)) return false
    return true
  })()

  const provider = shouldInclude
    ? await buildProviderFromSource({
        providerID,
        source,
        config: config.provider?.[providerID],
        authMap,
      })
    : undefined

  await runTx([runtimeDb.providers, runtimeDb.models, runtimeDb.meta], async () => {
    await runtimeDb.models
      .where("providerID")
      .equals(providerID)
      .delete()

    if (!provider) {
      await runtimeDb.providers.delete(providerID)
    } else {
      const { providerRow, modelRows } = providerToRows(provider, updatedAt)
      await runtimeDb.providers.put(providerRow)
      if (modelRows.length > 0) {
        await runtimeDb.models.bulkPut(modelRows)
      }
    }

    await runtimeDb.meta.put({
      key: CATALOG_UPDATED_AT_KEY,
      value: updatedAt,
      updatedAt,
    })
    await setCatalogInitialized(updatedAt)

    afterCommit(() => {
      publishRuntimeEvent({
        type: "runtime.providers.changed",
        payload: { providerIDs: [providerID] },
      })
      publishRuntimeEvent({
        type: "runtime.models.changed",
        payload: { providerIDs: [providerID] },
      })
    })
  })
}

export async function ensureProviderCatalog() {
  const initialized = await isCatalogInitialized()
  if (initialized) return
  await refreshProviderCatalog()
}

async function providerFromRows(providerID: string) {
  const [providerRow, modelRows] = await Promise.all([
    runtimeDb.providers.get(providerID),
    runtimeDb.models.where("providerID").equals(providerID).toArray(),
  ])

  if (!providerRow) return undefined

  const models = Object.fromEntries(modelRows.map((row) => [row.modelID, row.info] as const))

  return {
    id: providerRow.id,
    name: providerRow.name,
    source: providerRow.source,
    env: providerRow.env,
    connected: providerRow.connected,
    options: providerRow.options,
    models,
  } as ProviderInfo
}

export async function listProviderRows() {
  await ensureProviderCatalog()
  return runtimeDb.providers.toArray()
}

export async function listModelRows(options: {
  providerID?: string
  connectedOnly?: boolean
} = {}) {
  await ensureProviderCatalog()

  if (options.providerID) {
    return runtimeDb.models.where("providerID").equals(options.providerID).toArray()
  }

  if (options.connectedOnly) {
    const connectedProviderIDs = await runtimeDb.providers
      .toArray()
      .then((rows) => rows.filter((row) => row.connected).map((row) => row.id))

    if (connectedProviderIDs.length === 0) return []

    return runtimeDb.models
      .where("providerID")
      .anyOf(connectedProviderIDs)
      .toArray()
  }

  return runtimeDb.models.toArray()
}

export async function getProvider(providerID: string) {
  await ensureProviderCatalog()
  return providerFromRows(providerID)
}

export async function getModel(providerID: string, modelID: string) {
  await ensureProviderCatalog()
  const row = await runtimeDb.models.get(runtimeModelKey(providerID, modelID))
  return row?.info
}

export async function getProviderAuth(providerID: string) {
  return getAuth(providerID)
}
