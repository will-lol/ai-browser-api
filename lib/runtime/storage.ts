import { browser } from "@wxt-dev/browser"
import { RUNTIME_STATE_KEY } from "@/lib/runtime/constants"
import type { RuntimeState } from "@/lib/runtime/types"

const EMPTY_STATE: RuntimeState = {
  version: 2,
  config: {},
  auth: {},
  permissionsByOrigin: {},
  pendingRequests: [],
}

let writeQueue = Promise.resolve()

function sanitizeAuth(value: unknown): RuntimeState["auth"] {
  if (!value || typeof value !== "object") return {}
  const input = value as Record<string, unknown>
  const out: RuntimeState["auth"] = {}

  for (const [providerID, auth] of Object.entries(input)) {
    if (!auth || typeof auth !== "object") continue
    const record = auth as Record<string, unknown>

    if (record.type === "api" && typeof record.key === "string") {
      out[providerID] = {
        type: "api",
        key: record.key,
        metadata:
          record.metadata && typeof record.metadata === "object"
            ? (record.metadata as Record<string, string>)
            : undefined,
        createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
      }
      continue
    }

    if (record.type === "oauth" && typeof record.access === "string") {
      out[providerID] = {
        type: "oauth",
        access: record.access,
        refresh: typeof record.refresh === "string" ? record.refresh : undefined,
        expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : undefined,
        accountId: typeof record.accountId === "string" ? record.accountId : undefined,
        metadata:
          record.metadata && typeof record.metadata === "object"
            ? (record.metadata as Record<string, string>)
            : undefined,
        createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
      }
    }
  }

  return out
}

function sanitize(value: unknown): RuntimeState {
  if (!value || typeof value !== "object") return { ...EMPTY_STATE }
  const input = value as Partial<RuntimeState>
  return {
    version: 2,
    config: input.config ?? {},
    auth: sanitizeAuth(input.auth),
    permissionsByOrigin: input.permissionsByOrigin ?? {},
    pendingRequests: Array.isArray(input.pendingRequests) ? input.pendingRequests : [],
    modelsCache: input.modelsCache,
  }
}

export async function loadRuntimeState() {
  const stored = await browser.storage.local.get(RUNTIME_STATE_KEY)
  return sanitize(stored[RUNTIME_STATE_KEY])
}

export async function saveRuntimeState(state: RuntimeState) {
  const next = sanitize(state)
  writeQueue = writeQueue.then(async () => {
    await browser.storage.local.set({
      [RUNTIME_STATE_KEY]: next,
    })
  })
  await writeQueue
}
