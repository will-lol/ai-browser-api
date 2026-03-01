import { runtimeDb } from "@/lib/runtime/db/runtime-db"
import {
  listModelRows,
  listProviderRows,
} from "@/lib/runtime/provider-registry"
import {
  getOriginPermissions,
  listPendingRequests,
  listPermissions,
} from "@/lib/runtime/permissions"

export async function listProviders() {
  const rows = await listProviderRows()
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      connected: row.connected,
      env: row.env,
      modelCount: row.modelCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listModels(options: {
  connectedOnly?: boolean
  providerID?: string
} = {}) {
  const [modelRows, providerRows] = await Promise.all([
    listModelRows(options),
    listProviderRows(),
  ])

  const providers = new Map(providerRows.map((row) => [row.id, row] as const))

  return modelRows
    .map((row) => {
      const provider = providers.get(row.providerID)
      return {
        id: row.id,
        modelId: row.id,
        name: row.name,
        modelName: row.name,
        provider: row.providerID,
        capabilities: row.capabilities,
        connected: provider?.connected ?? false,
      }
    })
    .sort((a, b) => a.modelName.localeCompare(b.modelName))
}

export async function getOriginState(origin: string) {
  const state = await getOriginPermissions(origin)
  return {
    origin,
    enabled: state.enabled,
  }
}

export async function listPermissionsForOrigin(origin: string) {
  const rows = await listPermissions(origin)
  if (rows.length === 0) return []

  const modelRows = await runtimeDb.models.bulkGet(rows.map((row) => row.modelId))
  const modelById = new Map(
    modelRows
      .filter((row): row is NonNullable<typeof row> => row != null)
      .map((row) => [row.id, row] as const),
  )

  return rows.map((row) => {
    const modelRow = modelById.get(row.modelId)
    const fallbackProvider = row.modelId.split("/")[0] ?? "unknown"
    const fallbackModelName = row.modelId.split("/")[1] ?? row.modelId

    return {
      modelId: row.modelId,
      modelName: modelRow?.name ?? fallbackModelName,
      provider: modelRow?.providerID ?? fallbackProvider,
      status: row.status,
      capabilities: modelRow?.capabilities ?? row.capabilities,
      requestedAt: row.updatedAt,
    }
  })
}

export async function listPendingRequestsForOrigin(origin: string) {
  return listPendingRequests(origin)
}
