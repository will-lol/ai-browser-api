import { getAuth, removeAuth, setAuth } from "@/lib/runtime/auth-store"
import type { AuthRecord, AuthResult } from "@/lib/runtime/auth-store"
import type { AuthAuthorization, AuthMethod, ResolvedAuthMethod } from "@/lib/runtime/plugin-manager"
import { getPluginManager } from "@/lib/runtime/plugins"
import { getProvider } from "@/lib/runtime/provider-registry"
import type { ProviderInfo } from "@/lib/runtime/provider-registry"

const PENDING_AUTH_TTL_MS = 10 * 60_000

type AuthContextResolved = {
  providerID: string
  provider: ProviderInfo
  auth?: AuthRecord
}

type PendingAuthSession = {
  providerID: string
  methodIndex: number
  method: AuthMethod
  resolved: ResolvedAuthMethod
  authorization: AuthAuthorization
  createdAt: number
  expiresAt: number
}

const pendingSessions = new Map<string, PendingAuthSession>()

async function resolveAuthContext(
  providerID: string,
  options: {
    provider?: ProviderInfo
    auth?: AuthRecord
  } = {},
): Promise<AuthContextResolved> {
  const provider = options.provider ?? (await getProvider(providerID))
  if (!provider) throw new Error(`Provider ${providerID} not found`)
  const auth = options.auth ?? (await getAuth(providerID))
  return {
    providerID,
    provider,
    auth,
  }
}

async function resolveMethod(providerID: string, methodIndex: number) {
  if (!Number.isInteger(methodIndex) || methodIndex < 0) {
    throw new Error(`Invalid auth method index for provider ${providerID}`)
  }

  const ctx = await resolveAuthContext(providerID)
  const pluginManager = getPluginManager()
  const methods = await pluginManager.listAuthMethods(ctx)
  if (methods.length === 0) {
    throw new Error(`No auth methods available for provider ${providerID}`)
  }

  const resolved = await pluginManager.resolveAuthMethod(ctx, methodIndex)
  if (!resolved) {
    throw new Error(`Auth method index ${methodIndex} is out of bounds for provider ${providerID}`)
  }

  return {
    ctx,
    method: resolved.method,
    resolved,
    methods,
  }
}

function clearPendingSession(providerID: string) {
  pendingSessions.delete(providerID)
}

function setPendingSession(input: {
  providerID: string
  methodIndex: number
  method: AuthMethod
  resolved: ResolvedAuthMethod
  authorization: AuthAuthorization
}) {
  const now = Date.now()
  pendingSessions.set(input.providerID, {
    providerID: input.providerID,
    methodIndex: input.methodIndex,
    method: input.method,
    resolved: input.resolved,
    authorization: input.authorization,
    createdAt: now,
    expiresAt: now + PENDING_AUTH_TTL_MS,
  })
}

function getPendingSession(providerID: string) {
  const pending = pendingSessions.get(providerID)
  if (!pending) return undefined
  if (Date.now() <= pending.expiresAt) return pending
  pendingSessions.delete(providerID)
  return undefined
}

export async function listProviderAuthMethods(
  providerID: string,
  options: {
    provider?: ProviderInfo
    auth?: AuthRecord
  } = {},
) {
  const provider = options.provider ?? (await getProvider(providerID))
  if (!provider) return []
  const pluginManager = getPluginManager()
  return pluginManager.listAuthMethods({
    providerID,
    provider,
    auth: options.auth ?? (await getAuth(providerID)),
  })
}

async function persistAuth(providerID: string, result: AuthResult) {
  if (result.type === "api") {
    await setAuth(providerID, {
      type: "api",
      key: result.key,
      metadata: result.metadata,
    })
    return
  }

  await setAuth(providerID, {
    type: "oauth",
    access: result.access,
    refresh: result.refresh,
    expiresAt: result.expiresAt,
    accountId: result.accountId,
    metadata: result.metadata,
  })
}

export async function startProviderAuth(input: {
  providerID: string
  methodIndex: number
  values?: Record<string, string>
}) {
  const { ctx, method, resolved } = await resolveMethod(input.providerID, input.methodIndex)
  const pluginManager = getPluginManager()
  const authorization = await pluginManager.authorize(ctx, resolved, input.values ?? {})
  if (!authorization) throw new Error(`Auth method index ${input.methodIndex} did not return authorization`)

  if ("type" in authorization) {
    await persistAuth(input.providerID, authorization)
    clearPendingSession(input.providerID)
    return {
      methodIndex: input.methodIndex,
      method,
      connected: true,
    }
  }

  if (method.type !== "oauth") {
    throw new Error(`Authorization flow for provider ${input.providerID} method ${input.methodIndex} is invalid`)
  }

  setPendingSession({
    providerID: input.providerID,
    methodIndex: input.methodIndex,
    method,
    resolved,
    authorization,
  })

  return {
    methodIndex: input.methodIndex,
    method,
    connected: false,
    pending: true,
    authorization,
  }
}

export async function finishProviderAuth(input: {
  providerID: string
  methodIndex: number
  code?: string
  callbackUrl?: string
}) {
  const pending = getPendingSession(input.providerID)
  if (!pending) {
    throw new Error(`Pending auth session for provider ${input.providerID} not found or expired`)
  }
  if (pending.methodIndex !== input.methodIndex) {
    throw new Error(`Auth method index mismatch for provider ${input.providerID}`)
  }

  const ctx = await resolveAuthContext(input.providerID)
  const pluginManager = getPluginManager()
  const result = await pluginManager.callback(ctx, pending.resolved, {
    code: input.code?.trim() || undefined,
    callbackUrl: input.callbackUrl?.trim() || undefined,
  })

  if (!result) {
    throw new Error(`OAuth callback returned empty result for ${input.providerID}`)
  }

  await persistAuth(input.providerID, result)
  clearPendingSession(input.providerID)

  return {
    methodIndex: input.methodIndex,
    method: pending.method,
    connected: true,
  }
}

export async function disconnectProvider(providerID: string) {
  clearPendingSession(providerID)
  await removeAuth(providerID)
}
