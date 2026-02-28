import { browser } from "@wxt-dev/browser"
import type {
  AuthAuthorization,
  AuthContext,
  AuthMethod,
  AuthResult,
  ChatTransformContext,
  HookResultMerge,
  ProviderInfo,
  ProviderModelInfo,
  ProviderPatchContext,
  RuntimeConfig,
  RuntimePlugin,
} from "@/lib/runtime/types"
import { isObject } from "@/lib/runtime/util"

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

  async listAuthMethods(ctx: AuthContext) {
    const methods: AuthMethod[] = []
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const next = await plugin.hooks.auth?.methods?.(ctx)
        if (!next || next.length === 0) continue
        methods.push(...next)
      } catch (error) {
        console.error(`[plugin:${plugin.id}] auth.methods failed`, error)
      }
    }
    return methods
  }

  async authorize(ctx: AuthContext, method: AuthMethod, input: Record<string, string>) {
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.auth?.authorize?.(ctx, method, input)
        if (!result) continue
        return result
      } catch (error) {
        console.error(`[plugin:${plugin.id}] auth.authorize failed`, error)
      }
    }
    return undefined
  }

  async callback(ctx: AuthContext, method: AuthMethod, input: { code?: string; callbackUrl?: string }) {
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.auth?.callback?.(ctx, method, input)
        if (!result) continue
        return result
      } catch (error) {
        console.error(`[plugin:${plugin.id}] auth.callback failed`, error)
      }
    }
    return undefined
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

export type PluginAuthResolved = AuthAuthorization | AuthResult
