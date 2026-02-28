import { MAX_PENDING_REQUESTS, PENDING_REQUEST_TIMEOUT_MS } from "@/lib/runtime/constants"
import { runtimeDb } from "@/lib/runtime/db/runtime-db"
import { runtimePermissionKey } from "@/lib/runtime/db/runtime-db-types"
import { afterCommit, runTx } from "@/lib/runtime/db/runtime-db-tx"
import { publishRuntimeEvent } from "@/lib/runtime/events/runtime-events"
import { getModelCapabilities, now, randomId } from "@/lib/runtime/util"

export type PermissionStatus = "allowed" | "denied" | "pending"

export interface PermissionRequest {
  id: string
  origin: string
  modelId: string
  modelName: string
  provider: string
  capabilities: string[]
  requestedAt: number
  dismissed: boolean
  status: "pending" | "resolved"
}

export async function listPermissions(origin: string) {
  const rows = await runtimeDb.permissions.where("origin").equals(origin).toArray()
  return rows.map((row) => ({
    modelId: row.modelId,
    status: row.status,
    capabilities: row.capabilities,
    updatedAt: row.updatedAt,
  }))
}

function toRuleMap(input: Awaited<ReturnType<typeof listPermissions>>) {
  return Object.fromEntries(input.map((rule) => [rule.modelId, rule] as const))
}

export async function getOriginPermissions(origin: string) {
  const [originRow, rules] = await Promise.all([
    runtimeDb.origins.get(origin),
    listPermissions(origin),
  ])

  return {
    enabled: originRow?.enabled ?? true,
    rules: toRuleMap(rules),
  }
}

export async function setOriginEnabled(origin: string, enabled: boolean) {
  await runTx([runtimeDb.origins], async () => {
    await runtimeDb.origins.put({
      origin,
      enabled,
      updatedAt: now(),
    })

    afterCommit(() => {
      publishRuntimeEvent({
        type: "runtime.origin.changed",
        payload: { origin },
      })
    })
  })
}

export async function setModelPermission(
  origin: string,
  modelId: string,
  status: PermissionStatus,
  capabilities?: string[],
) {
  const updatedAt = now()

  await runTx([runtimeDb.permissions], async () => {
    const existing = await runtimeDb.permissions.get(runtimePermissionKey(origin, modelId))
    await runtimeDb.permissions.put({
      id: runtimePermissionKey(origin, modelId),
      origin,
      modelId,
      status,
      capabilities: capabilities ?? existing?.capabilities ?? getModelCapabilities(modelId),
      updatedAt,
    })

    afterCommit(() => {
      publishRuntimeEvent({
        type: "runtime.permissions.changed",
        payload: {
          origin,
          modelIds: [modelId],
        },
      })
    })
  })
}

export async function getModelPermission(origin: string, modelId: string): Promise<PermissionStatus> {
  const [originState, permission] = await Promise.all([
    runtimeDb.origins.get(origin),
    runtimeDb.permissions.get(runtimePermissionKey(origin, modelId)),
  ])

  if (originState && !originState.enabled) return "denied"
  return permission?.status ?? "denied"
}

export async function createPermissionRequest(input: {
  origin: string
  modelId: string
  provider: string
  modelName: string
  capabilities?: string[]
}) {
  const duplicate = await runtimeDb.pendingRequests
    .where("origin")
    .equals(input.origin)
    .filter((item) => item.modelId === input.modelId && item.status === "pending" && !item.dismissed)
    .first()
  if (duplicate) {
    return duplicate
  }

  const capabilities = input.capabilities ?? getModelCapabilities(input.modelId)

  const request: PermissionRequest = {
    id: randomId("prm"),
    origin: input.origin,
    modelId: input.modelId,
    provider: input.provider,
    modelName: input.modelName,
    capabilities,
    requestedAt: now(),
    dismissed: false,
    status: "pending",
  }

  await runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
    await runtimeDb.permissions.put({
      id: runtimePermissionKey(input.origin, input.modelId),
      origin: input.origin,
      modelId: input.modelId,
      status: "pending",
      capabilities,
      updatedAt: now(),
    })

    await runtimeDb.pendingRequests.put(request)

    const all = await runtimeDb.pendingRequests.orderBy("requestedAt").toArray()
    const overflow = all.length - MAX_PENDING_REQUESTS
    if (overflow > 0) {
      const stale = all.slice(0, overflow).map((item) => item.id)
      if (stale.length > 0) {
        await runtimeDb.pendingRequests.bulkDelete(stale)
      }
    }

    afterCommit(() => {
      publishRuntimeEvent({
        type: "runtime.pending.changed",
        payload: {
          origin: input.origin,
          requestIds: [request.id],
        },
      })
      publishRuntimeEvent({
        type: "runtime.permissions.changed",
        payload: {
          origin: input.origin,
          modelIds: [input.modelId],
        },
      })
    })
  })

  return request
}

export async function dismissPermissionRequest(requestId: string) {
  await runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
    const match = await runtimeDb.pendingRequests.get(requestId)
    if (!match) return

    await runtimeDb.permissions.put({
      id: runtimePermissionKey(match.origin, match.modelId),
      origin: match.origin,
      modelId: match.modelId,
      status: "denied",
      capabilities: match.capabilities,
      updatedAt: now(),
    })

    await runtimeDb.pendingRequests.delete(requestId)

    afterCommit(() => {
      publishRuntimeEvent({
        type: "runtime.pending.changed",
        payload: {
          origin: match.origin,
          requestIds: [requestId],
        },
      })
      publishRuntimeEvent({
        type: "runtime.permissions.changed",
        payload: {
          origin: match.origin,
          modelIds: [match.modelId],
        },
      })
    })
  })
}

export async function resolvePermissionRequest(requestId: string, decision: "allowed" | "denied") {
  await runTx([runtimeDb.pendingRequests, runtimeDb.permissions], async () => {
    const match = await runtimeDb.pendingRequests.get(requestId)
    if (!match) return

    await runtimeDb.permissions.put({
      id: runtimePermissionKey(match.origin, match.modelId),
      origin: match.origin,
      modelId: match.modelId,
      status: decision,
      capabilities: match.capabilities,
      updatedAt: now(),
    })

    await runtimeDb.pendingRequests.delete(requestId)

    afterCommit(() => {
      publishRuntimeEvent({
        type: "runtime.pending.changed",
        payload: {
          origin: match.origin,
          requestIds: [requestId],
        },
      })
      publishRuntimeEvent({
        type: "runtime.permissions.changed",
        payload: {
          origin: match.origin,
          modelIds: [match.modelId],
        },
      })
    })
  })
}

export async function listPendingRequests(origin?: string) {
  const rows = await runtimeDb.pendingRequests
    .where("status")
    .equals("pending")
    .filter((item) => {
      if (item.dismissed) return false
      if (!origin) return true
      return item.origin === origin
    })
    .toArray()

  return rows
}

export async function waitForPermissionDecision(requestId: string, timeoutMs = PENDING_REQUEST_TIMEOUT_MS) {
  const start = now()
  while (now() - start < timeoutMs) {
    const pending = await runtimeDb.pendingRequests.get(requestId)
    if (!pending || pending.status !== "pending") {
      return "resolved"
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return "timeout"
}
