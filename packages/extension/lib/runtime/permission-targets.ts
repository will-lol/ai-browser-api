import { runtimeDb } from "@/lib/runtime/db/runtime-db"

export interface TrustedPermissionTarget {
  modelId: string
  modelName: string
  provider: string
  capabilities: string[]
}

export async function resolveTrustedPermissionTargets(
  modelIds: ReadonlyArray<string>,
): Promise<Map<string, TrustedPermissionTarget>> {
  const uniqueModelIds = Array.from(new Set(modelIds))
  if (uniqueModelIds.length === 0) {
    return new Map()
  }

  const rows = await runtimeDb.models.bulkGet(uniqueModelIds)
  const targets = new Map<string, TrustedPermissionTarget>()

  rows.forEach((row, index) => {
    if (!row) return

    const modelId = uniqueModelIds[index]
    targets.set(modelId, {
      modelId,
      modelName: row.info.name,
      provider: row.providerID,
      capabilities: [...row.capabilities],
    })
  })

  return targets
}

export async function resolveTrustedPermissionTarget(modelId: string) {
  return (await resolveTrustedPermissionTargets([modelId])).get(modelId)
}
