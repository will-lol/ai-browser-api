import { runtimeDb } from "@/lib/runtime/db/runtime-db"
import { runTx } from "@/lib/runtime/db/runtime-db-tx"
import type { RuntimeConfig } from "@/lib/runtime/types"

const RUNTIME_CONFIG_ID = "runtime-config" as const

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const row = await runtimeDb.config.get(RUNTIME_CONFIG_ID)
  return row?.value ?? {}
}

export async function setRuntimeConfig(config: RuntimeConfig) {
  const now = Date.now()
  await runTx([runtimeDb.config], async () => {
    await runtimeDb.config.put({
      id: RUNTIME_CONFIG_ID,
      value: config,
      updatedAt: now,
    })
  })
}
