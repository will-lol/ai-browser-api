import { runtimeDb } from "@/lib/runtime/db/runtime-db"
import type { RuntimeConfig } from "@/lib/runtime/types"

const RUNTIME_CONFIG_ID = "runtime-config" as const

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const row = await runtimeDb.config.get(RUNTIME_CONFIG_ID)
  return row?.value ?? {}
}
