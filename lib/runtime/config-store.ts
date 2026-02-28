import { runtimeDb } from "@/lib/runtime/db/runtime-db"
import type { ModelsDevModel } from "@/lib/runtime/models-dev"

export interface RuntimeProviderConfig {
  name?: string
  env?: string[]
  whitelist?: string[]
  blacklist?: string[]
  options?: Record<string, unknown>
  models?: Record<
    string,
    Partial<ModelsDevModel> & {
      disabled?: boolean
      variants?: Record<string, Record<string, unknown>>
    }
  >
}

export interface RuntimeConfig {
  enabled_providers?: string[]
  disabled_providers?: string[]
  model?: string
  small_model?: string
  provider?: Record<string, RuntimeProviderConfig>
}

const RUNTIME_CONFIG_ID = "runtime-config" as const

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const row = await runtimeDb.config.get(RUNTIME_CONFIG_ID)
  return row?.value ?? {}
}
