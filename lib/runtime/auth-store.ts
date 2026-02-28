import { runtimeDb } from "@/lib/runtime/db/runtime-db"
import { afterCommit, runTx } from "@/lib/runtime/db/runtime-db-tx"
import { publishRuntimeEvent } from "@/lib/runtime/events/runtime-events"
import { now } from "@/lib/runtime/util"

export type AuthRecord =
  | {
      type: "api"
      key: string
      metadata?: Record<string, string>
      createdAt: number
      updatedAt: number
    }
  | {
      type: "oauth"
      access: string
      refresh?: string
      expiresAt?: number
      accountId?: string
      metadata?: Record<string, string>
      createdAt: number
      updatedAt: number
    }

export type AuthResult =
  | { type: "api"; key: string; metadata?: Record<string, string> }
  | {
      type: "oauth"
      access: string
      refresh?: string
      expiresAt?: number
      accountId?: string
      metadata?: Record<string, string>
    }

export async function getAuth(providerID: string) {
  return runtimeDb.auth.get(providerID).then((row) => row?.record)
}

export async function listAuth() {
  const rows = await runtimeDb.auth.toArray()
  return Object.fromEntries(rows.map((row) => [row.providerID, row.record] as const))
}

export async function setAuth(providerID: string, value: AuthResult) {
  const existing = await getAuth(providerID)
  const createdAt = existing?.createdAt ?? now()
  const updatedAt = now()

  const auth: AuthRecord =
    value.type === "api"
      ? {
          type: "api",
          key: value.key,
          metadata: value.metadata,
          createdAt,
          updatedAt,
        }
      : {
          type: "oauth",
          access: value.access,
          refresh: value.refresh,
          expiresAt: value.expiresAt,
          accountId: value.accountId,
          metadata: value.metadata,
          createdAt,
          updatedAt,
        }

  await runTx([runtimeDb.auth, runtimeDb.providers], async () => {
    await runtimeDb.auth.put({
      providerID,
      record: auth,
      updatedAt,
    })

    const provider = await runtimeDb.providers.get(providerID)
    if (provider) {
      await runtimeDb.providers.put({
        ...provider,
        connected: true,
        updatedAt,
      })
    }

    afterCommit(() => {
      publishRuntimeEvent({
        type: "runtime.auth.changed",
        payload: { providerID },
      })
      publishRuntimeEvent({
        type: "runtime.providers.changed",
        payload: { providerIDs: [providerID] },
      })
    })
  })

  return auth
}

export async function removeAuth(providerID: string) {
  await runTx([runtimeDb.auth, runtimeDb.providers], async () => {
    await runtimeDb.auth.delete(providerID)

    const provider = await runtimeDb.providers.get(providerID)
    if (provider) {
      await runtimeDb.providers.put({
        ...provider,
        connected: false,
        updatedAt: now(),
      })
    }

    afterCommit(() => {
      publishRuntimeEvent({
        type: "runtime.auth.changed",
        payload: { providerID },
      })
      publishRuntimeEvent({
        type: "runtime.providers.changed",
        payload: { providerIDs: [providerID] },
      })
    })
  })
}
