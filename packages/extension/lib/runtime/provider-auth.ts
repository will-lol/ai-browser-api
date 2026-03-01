import { getAuth, removeAuth, setAuth } from "@/lib/runtime/auth-store"
import type { AuthRecord, AuthResult } from "@/lib/runtime/auth-store"
import type {
  AuthContinuationContext,
  AuthMethod,
  PendingAuthResult,
  ResolvedAuthReference,
} from "@/lib/runtime/plugin-manager"
import { getPluginManager } from "@/lib/runtime/plugins"
import { getProvider } from "@/lib/runtime/provider-registry"
import type { ProviderInfo } from "@/lib/runtime/provider-registry"

type AuthContextResolved = {
  providerID: string
  provider: ProviderInfo
  auth?: AuthRecord
}

export type PendingProviderAuthSession = {
  methodIndex: number
  method: AuthMethod
  resolved: ResolvedAuthReference
  authorization: PendingAuthResult["authorization"]
  context?: AuthContinuationContext
}

export type StartProviderAuthResult =
  | {
      methodIndex: number
      method: AuthMethod
      connected: true
    }
  | ({
      connected: false
      pending: true
    } & PendingProviderAuthSession)

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
  }
}

function isPendingAuthResult(value: AuthResult | PendingAuthResult): value is PendingAuthResult {
  return "authorization" in value
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

export async function startProviderAuth(input: {
  providerID: string
  methodIndex: number
  values?: Record<string, string>
}): Promise<StartProviderAuthResult> {
  const { ctx, method, resolved } = await resolveMethod(input.providerID, input.methodIndex)
  const pluginManager = getPluginManager()
  const result = await pluginManager.authorize(ctx, resolved, input.values ?? {})
  if (!result) throw new Error(`Auth method index ${input.methodIndex} did not return authorization`)

  if (!isPendingAuthResult(result)) {
    await persistAuth(input.providerID, result)
    return {
      methodIndex: input.methodIndex,
      method,
      connected: true,
    }
  }

  if (method.type !== "oauth") {
    throw new Error(`Authorization flow for provider ${input.providerID} method ${input.methodIndex} is invalid`)
  }

  return {
    connected: false,
    pending: true,
    methodIndex: input.methodIndex,
    method,
    authorization: result.authorization,
    context: result.context,
    resolved: {
      pluginID: resolved.pluginID,
      pluginMethodIndex: resolved.pluginMethodIndex,
    },
  }
}

export async function finishProviderAuth(input: {
  providerID: string
  methodIndex: number
  resolved: ResolvedAuthReference
  context?: AuthContinuationContext
  code?: string
  callbackUrl?: string
  signal?: AbortSignal
}) {
  const ctx = await resolveAuthContext(input.providerID)
  const pluginManager = getPluginManager()
  const resolved = await pluginManager.resolveAuthMethodByReference(ctx, input.resolved)
  if (!resolved) {
    throw new Error(`Pending auth method ${input.resolved.pluginID}:${input.resolved.pluginMethodIndex} was not found for provider ${input.providerID}`)
  }

  const methods = await pluginManager.listAuthMethods(ctx)
  if (input.methodIndex < 0 || input.methodIndex >= methods.length) {
    throw new Error(`Auth method index ${input.methodIndex} is out of bounds for provider ${input.providerID}`)
  }

  const method = methods[input.methodIndex]
  if (method.type !== resolved.method.type || method.label !== resolved.method.label) {
    throw new Error(`Auth method changed while finishing provider ${input.providerID}`)
  }

  const result = await pluginManager.callback(ctx, resolved, {
    context: input.context,
    code: input.code?.trim() || undefined,
    callbackUrl: input.callbackUrl?.trim() || undefined,
    signal: input.signal,
  })

  if (!result) {
    throw new Error(`OAuth callback returned empty result for ${input.providerID}`)
  }

  await persistAuth(input.providerID, result)

  return {
    methodIndex: input.methodIndex,
    method: resolved.method,
    connected: true,
  }
}

export async function disconnectProvider(providerID: string) {
  await removeAuth(providerID)
}
