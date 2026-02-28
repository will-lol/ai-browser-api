import { browser } from "@wxt-dev/browser"
import { getAuth, removeAuth, setAuth } from "@/lib/runtime/auth-store"
import type { AuthRecord, AuthResult } from "@/lib/runtime/auth-store"
import type { AuthMethod } from "@/lib/runtime/plugin-manager"
import { getPluginManager } from "@/lib/runtime/plugins"
import { getProvider } from "@/lib/runtime/provider-registry"
import type { ProviderInfo } from "@/lib/runtime/provider-registry"

async function resolveMethod(providerID: string, methodID?: string) {
  const provider = await getProvider(providerID)
  if (!provider) throw new Error(`Provider ${providerID} not found`)

  const pluginManager = getPluginManager()
  const methods = await pluginManager.listAuthMethods({
    providerID,
    provider,
    auth: await getAuth(providerID),
  })

  if (methods.length === 0) {
    throw new Error(`No auth methods available for provider ${providerID}`)
  }

  const method = methods.find((item) => item.id === methodID) ?? methods[0]
  return {
    provider,
    method,
    methods,
  }
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

export async function connectProvider(input: {
  providerID: string
  methodID?: string
  values?: Record<string, string>
  code?: string
}) {
  const { provider, method } = await resolveMethod(input.providerID, input.methodID)
  const pluginManager = getPluginManager()
  const ctx = {
    providerID: input.providerID,
    provider,
    auth: await getAuth(input.providerID),
  }

  const authorization = await pluginManager.authorize(ctx, method, input.values ?? {})
  if (!authorization) throw new Error(`Auth method ${method.id} did not return authorization`)

  if ("type" in authorization) {
    await persistAuth(input.providerID, authorization)
    return {
      method,
      connected: true,
    }
  }

  if (method.type !== "oauth") {
    throw new Error(`Authorization flow for method ${method.id} is invalid`)
  }

  if (authorization.mode === "auto") {
    const callbackUrl = await runAutoOAuth(method, authorization.url)
    const callbackCode = callbackUrl ? new URL(callbackUrl).searchParams.get("code") ?? undefined : undefined
    const result = await pluginManager.callback(ctx, method, {
      code: callbackCode,
      callbackUrl: callbackUrl ?? undefined,
    })
    if (!result) throw new Error(`OAuth callback returned empty result for ${input.providerID}`)
    await persistAuth(input.providerID, result)
    return {
      method,
      connected: true,
    }
  }

  const code = input.code?.trim()
  if (!code) {
    return {
      method,
      connected: false,
      pending: true,
      authorization,
    }
  }

  const result = await pluginManager.callback(ctx, method, {
    code,
    callbackUrl: code,
  })
  if (!result) throw new Error(`OAuth callback returned empty result for ${input.providerID}`)
  await persistAuth(input.providerID, result)

  return {
    method,
    connected: true,
  }
}

async function runAutoOAuth(method: AuthMethod, url: string) {
  if (method.type !== "oauth") return undefined

  if (method.mode === "device") {
    return undefined
  }

  if (!browser.identity?.launchWebAuthFlow) {
    throw new Error("browser.identity.launchWebAuthFlow is not available")
  }

  const callback = await browser.identity.launchWebAuthFlow({
    url,
    interactive: true,
  })

  return callback ?? undefined
}

export async function disconnectProvider(providerID: string) {
  await removeAuth(providerID)
}
