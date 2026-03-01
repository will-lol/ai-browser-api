import { browser } from "@wxt-dev/browser"
import type { AuthRecord, AuthResult } from "@/lib/runtime/auth-store"
import type { RuntimeConfig } from "@/lib/runtime/config-store"
import type { ProviderInfo, ProviderModelInfo } from "@/lib/runtime/provider-registry"
import { isObject } from "@/lib/runtime/util"

type AuthFieldCondition = {
  key: string
  equals: string
}

type AuthFieldValidation = {
  regex?: string
  message?: string
  minLength?: number
  maxLength?: number
}

type AuthFieldBase = {
  key: string
  label: string
  placeholder?: string
  defaultValue?: string
  required?: boolean
  description?: string
  condition?: AuthFieldCondition
  validate?: AuthFieldValidation
}

type AuthFieldOption = {
  label: string
  value: string
  hint?: string
}

export type AuthField =
  | ({
      type: "text" | "secret"
    } & AuthFieldBase)
  | ({
      type: "select"
      options: AuthFieldOption[]
    } & AuthFieldBase)

export type AuthMethod =
  | {
      type: "api"
      label: string
      fields?: AuthField[]
    }
  | {
      type: "oauth"
      label: string
      mode?: "browser" | "device"
      fields?: AuthField[]
    }

export type AuthAuthorization = {
  mode: "auto" | "code"
  url: string
  instructions?: string
}

export type AuthContinuationContext = Record<string, unknown>

export type PendingAuthResult = {
  authorization: AuthAuthorization
  context?: AuthContinuationContext
}

export type ResolvedAuthReference = {
  pluginID: string
  pluginMethodIndex: number
}

export interface ResolvedAuthMethod {
  pluginID: string
  pluginMethodIndex: number
  method: AuthMethod
  plugin: RuntimePlugin
}

export interface AuthContext {
  providerID: string
  provider: ProviderInfo
  auth?: AuthRecord
}

export interface ProviderPatchContext {
  providerID: string
  provider?: ProviderInfo
  auth?: AuthRecord
}

export interface ChatTransformContext {
  providerID: string
  modelID: string
  origin: string
  sessionID: string
  requestID: string
  auth?: AuthRecord
}

export interface HookResultMerge {
  strategy: "merge"
  value: Record<string, unknown>
}

export interface PluginHooks {
  auth?: {
    methods?: (ctx: AuthContext) => Promise<AuthMethod[]>
    authorize?: (
      ctx: AuthContext,
      method: AuthMethod,
      input: Record<string, string>,
      info: { methodIndex: number },
    ) => Promise<PendingAuthResult | AuthResult | void>
    callback?: (
      ctx: AuthContext,
      method: AuthMethod,
      input: {
        context?: AuthContinuationContext
        code?: string
        callbackUrl?: string
        signal?: AbortSignal
      },
      info: { methodIndex: number },
    ) => Promise<AuthResult | void>
    loader?: (ctx: AuthContext) => Promise<Record<string, unknown>>
  }
  provider?: {
    patchProvider?: (ctx: ProviderPatchContext, provider: ProviderInfo) => Promise<ProviderInfo | void>
    patchModel?: (ctx: ProviderPatchContext, model: ProviderModelInfo) => Promise<ProviderModelInfo | void>
    requestOptions?: (
      ctx: ChatTransformContext,
      options: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | HookResultMerge | void>
  }
  chat?: {
    params?: (
      ctx: ChatTransformContext,
      params: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | HookResultMerge | void>
    headers?: (
      ctx: ChatTransformContext,
      headers: Record<string, string>,
    ) => Promise<Record<string, string> | HookResultMerge | void>
    transformRequest?: (
      ctx: ChatTransformContext,
      body: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | void>
    transformResponse?: (
      ctx: ChatTransformContext,
      body: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | void>
  }
  tool?: {
    list?: (
      ctx: ChatTransformContext,
    ) => Promise<Array<{ id: string; description: string; parameters: Record<string, unknown> }>>
  }
  event?: {
    onEvent?: (name: string, payload: Record<string, unknown>) => Promise<void>
  }
  config?: {
    extend?: (config: RuntimeConfig) => Promise<RuntimeConfig | void>
    validate?: (config: RuntimeConfig) => Promise<void>
  }
}

export interface RuntimePlugin {
  id: string
  name: string
  supportedProviders?: string[]
  requiredBrowserApis?: string[]
  hooks: PluginHooks
}

function supportsProvider(plugin: RuntimePlugin, providerID: string) {
  if (!plugin.supportedProviders || plugin.supportedProviders.length === 0) return true
  return plugin.supportedProviders.includes(providerID)
}

function hasBrowserApi(path: string) {
  const parts = path.split(".")
  let node: unknown = browser
  for (const part of parts) {
    if (!node || typeof node !== "object" || !(part in node)) return false
    node = (node as Record<string, unknown>)[part]
  }
  return true
}

function isMergeResult(value: unknown): value is HookResultMerge {
  return isObject(value) && value.strategy === "merge" && isObject(value.value)
}

function mergeObjects<T extends Record<string, unknown>>(base: T, value: Record<string, unknown>) {
  return {
    ...base,
    ...value,
  } as T
}

function normalizeAuthMethod(method: AuthMethod): AuthMethod {
  if (method.type !== "oauth") return method
  return {
    ...method,
    mode: method.mode ?? "browser",
  }
}

export class PluginManager {
  readonly plugins: RuntimePlugin[]

  constructor(plugins: RuntimePlugin[]) {
    this.plugins = plugins.filter((plugin) => {
      const required = plugin.requiredBrowserApis ?? []
      return required.every(hasBrowserApi)
    })
  }

  private providerPlugins(providerID: string) {
    return this.plugins.filter((plugin) => supportsProvider(plugin, providerID))
  }

  private isFallbackAuthPlugin(plugin: RuntimePlugin) {
    return plugin.id === "builtin-api-key-auth"
  }

  async listResolvedAuthMethods(ctx: AuthContext) {
    const providerSpecific: ResolvedAuthMethod[] = []
    const fallback: ResolvedAuthMethod[] = []

    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const methods = await plugin.hooks.auth?.methods?.(ctx)
        if (!methods || methods.length === 0) continue

        const target = this.isFallbackAuthPlugin(plugin) ? fallback : providerSpecific
        methods.forEach((method, pluginMethodIndex) => {
          target.push({
            pluginID: plugin.id,
            pluginMethodIndex,
            method: normalizeAuthMethod(method),
            plugin,
          })
        })
      } catch (error) {
        console.error(`[plugin:${plugin.id}] auth.methods failed`, error)
      }
    }

    if (providerSpecific.length > 0) {
      return [...providerSpecific, ...fallback]
    }
    return fallback
  }

  async listAuthMethods(ctx: AuthContext) {
    const methods = await this.listResolvedAuthMethods(ctx)
    return methods.map((item) => item.method)
  }

  async resolveAuthMethod(ctx: AuthContext, methodIndex: number) {
    const methods = await this.listResolvedAuthMethods(ctx)
    return methods[methodIndex]
  }

  async resolveAuthMethodByReference(ctx: AuthContext, reference: ResolvedAuthReference) {
    const methods = await this.listResolvedAuthMethods(ctx)
    return methods.find((resolved) =>
      resolved.pluginID === reference.pluginID
      && resolved.pluginMethodIndex === reference.pluginMethodIndex)
  }

  async authorize(ctx: AuthContext, resolved: ResolvedAuthMethod, input: Record<string, string>) {
    const result = await resolved.plugin.hooks.auth?.authorize?.(ctx, resolved.method, input, {
      methodIndex: resolved.pluginMethodIndex,
    })
    if (!result) return undefined
    return result
  }

  async callback(
    ctx: AuthContext,
    resolved: ResolvedAuthMethod,
    input: {
      context?: AuthContinuationContext
      code?: string
      callbackUrl?: string
      signal?: AbortSignal
    },
  ) {
    const result = await resolved.plugin.hooks.auth?.callback?.(ctx, resolved.method, input, {
      methodIndex: resolved.pluginMethodIndex,
    })
    if (!result) return undefined
    return result
  }

  async loadAuthOptions(ctx: AuthContext) {
    let options: Record<string, unknown> = {}
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.auth?.loader?.(ctx)
        if (!result) continue
        options = mergeObjects(options, result)
      } catch (error) {
        console.error(`[plugin:${plugin.id}] auth.loader failed`, error)
      }
    }
    return options
  }

  async patchProvider(ctx: ProviderPatchContext, provider: ProviderInfo) {
    let next = provider
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const patched = await plugin.hooks.provider?.patchProvider?.(ctx, next)
        if (!patched) continue
        next = patched
      } catch (error) {
        console.error(`[plugin:${plugin.id}] provider.patchProvider failed`, error)
      }
    }
    return next
  }

  async patchModel(ctx: ProviderPatchContext, model: ProviderModelInfo) {
    let next = model
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const patched = await plugin.hooks.provider?.patchModel?.(ctx, next)
        if (!patched) continue
        next = patched
      } catch (error) {
        console.error(`[plugin:${plugin.id}] provider.patchModel failed`, error)
      }
    }
    return next
  }

  async applyRequestOptions(ctx: ChatTransformContext, options: Record<string, unknown>) {
    let next = { ...options }
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.provider?.requestOptions?.(ctx, next)
        if (!result) continue
        if (isMergeResult(result)) {
          next = mergeObjects(next, result.value)
          continue
        }
        next = result
      } catch (error) {
        console.error(`[plugin:${plugin.id}] provider.requestOptions failed`, error)
      }
    }
    return next
  }

  async applyChatParams(ctx: ChatTransformContext, params: Record<string, unknown>) {
    let next = { ...params }
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.chat?.params?.(ctx, next)
        if (!result) continue
        if (isMergeResult(result)) {
          next = mergeObjects(next, result.value)
          continue
        }
        next = result
      } catch (error) {
        console.error(`[plugin:${plugin.id}] chat.params failed`, error)
      }
    }
    return next
  }

  async applyChatHeaders(ctx: ChatTransformContext, headers: Record<string, string>) {
    let next = { ...headers }
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.chat?.headers?.(ctx, next)
        if (!result) continue
        if (isMergeResult(result)) {
          next = mergeObjects(next, result.value as Record<string, string>)
          continue
        }
        next = result
      } catch (error) {
        console.error(`[plugin:${plugin.id}] chat.headers failed`, error)
      }
    }
    return next
  }

  async transformRequest(ctx: ChatTransformContext, body: Record<string, unknown>) {
    let next = { ...body }
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.chat?.transformRequest?.(ctx, next)
        if (!result) continue
        next = result
      } catch (error) {
        console.error(`[plugin:${plugin.id}] chat.transformRequest failed`, error)
      }
    }
    return next
  }

  async transformResponse(ctx: ChatTransformContext, body: Record<string, unknown>) {
    let next = { ...body }
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.chat?.transformResponse?.(ctx, next)
        if (!result) continue
        next = result
      } catch (error) {
        console.error(`[plugin:${plugin.id}] chat.transformResponse failed`, error)
      }
    }
    return next
  }

  async listTools(ctx: ChatTransformContext) {
    const tools: Array<{ id: string; description: string; parameters: Record<string, unknown> }> = []
    for (const plugin of this.plugins) {
      try {
        const result = await plugin.hooks.tool?.list?.(ctx)
        if (!result || result.length === 0) continue
        tools.push(...result)
      } catch (error) {
        console.error(`[plugin:${plugin.id}] tool.list failed`, error)
      }
    }
    return tools
  }

  async emit(name: string, payload: Record<string, unknown>) {
    for (const plugin of this.plugins) {
      try {
        await plugin.hooks.event?.onEvent?.(name, payload)
      } catch (error) {
        console.error(`[plugin:${plugin.id}] event failed`, error)
      }
    }
  }

  async extendConfig(config: RuntimeConfig) {
    let next = { ...config }
    for (const plugin of this.plugins) {
      try {
        const result = await plugin.hooks.config?.extend?.(next)
        if (!result) continue
        next = result
      } catch (error) {
        console.error(`[plugin:${plugin.id}] config.extend failed`, error)
      }
    }

    for (const plugin of this.plugins) {
      try {
        await plugin.hooks.config?.validate?.(next)
      } catch (error) {
        console.error(`[plugin:${plugin.id}] config.validate failed`, error)
      }
    }

    return next
  }
}

export type PluginAuthResolved = PendingAuthResult | AuthResult
