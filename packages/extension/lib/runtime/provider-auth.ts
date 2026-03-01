import { getAuth, removeAuth, setAuth } from "@/lib/runtime/auth-store"
import type { AuthRecord, AuthResult } from "@/lib/runtime/auth-store"
import type { AuthMethodType, RuntimeAuthMethod } from "@/lib/runtime/plugin-manager"
import { getPluginManager } from "@/lib/runtime/plugins"
import { getProvider } from "@/lib/runtime/provider-registry"
import type { ProviderRuntimeInfo } from "@/lib/runtime/provider-registry"

type AuthContextResolved = {
  providerID: string
  provider: ProviderRuntimeInfo
  auth?: AuthRecord
}

export type StartProviderAuthResult = {
  methodID: string
  connected: true
}

async function resolveAuthContext(
  providerID: string,
  options: {
    provider?: ProviderRuntimeInfo
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

async function persistAuth(providerID: string, methodType: AuthMethodType, result: AuthResult) {
  if (result.type === "api") {
    const metadata = {
      ...(result.metadata ?? {}),
      ...(methodType === "pat" || methodType === "apikey" ? { authMethod: methodType } : {}),
    }

    await setAuth(providerID, {
      type: "api",
      key: result.key,
      metadata,
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
    provider?: ProviderRuntimeInfo
    auth?: AuthRecord
  } = {},
): Promise<RuntimeAuthMethod[]> {
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
  methodID: string
  values?: Record<string, string>
  signal?: AbortSignal
}): Promise<StartProviderAuthResult> {
  const ctx = await resolveAuthContext(input.providerID)
  const pluginManager = getPluginManager()
  const resolved = await pluginManager.resolveAuthMethod(ctx, input.methodID)
  if (!resolved) {
    throw new Error(`Auth method ${input.methodID} was not found for provider ${input.providerID}`)
  }

  const result = await pluginManager.authorize(
    ctx,
    resolved,
    input.values ?? {},
    input.signal,
  )

  await persistAuth(input.providerID, resolved.method.type, result)

  return {
    methodID: resolved.method.id,
    connected: true,
  }
}

export async function disconnectProvider(providerID: string) {
  await removeAuth(providerID)
}
