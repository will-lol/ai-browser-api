import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { RuntimeAuthFlowInstruction } from "@llm-bridge/contracts";
import { browser } from "@wxt-dev/browser";
import type { AuthRecord, AuthResult } from "@/lib/runtime/auth-store";
import type { RuntimeConfig } from "@/lib/runtime/config-store";
import { parseOAuthCallbackUrl } from "@/lib/runtime/plugins/oauth-util";
import type {
  ProviderInfo,
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/lib/runtime/provider-registry";
import { isObject, mergeRecord } from "@/lib/runtime/util";

type AuthFieldCondition = {
  key: string;
  equals: string;
};

type AuthFieldValidation = {
  regex?: string;
  message?: string;
  minLength?: number;
  maxLength?: number;
};

type AuthFieldBase = {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  description?: string;
  condition?: AuthFieldCondition;
  validate?: AuthFieldValidation;
};

type AuthFieldOption = {
  label: string;
  value: string;
  hint?: string;
};

export type AuthField =
  | ({
      type: "text" | "secret";
    } & AuthFieldBase)
  | ({
      type: "select";
      options: AuthFieldOption[];
    } & AuthFieldBase);

export type AuthMethodType = "oauth" | "pat" | "apikey";

export interface PluginAuthorizeContext {
  providerID: string;
  provider: ProviderRuntimeInfo;
  auth?: AuthRecord;
  values: Record<string, string>;
  signal?: AbortSignal;
  oauth: {
    getRedirectURL: (path?: string) => string;
    launchWebAuthFlow: (url: string) => Promise<string>;
    parseCallback: (url: string) => {
      code?: string;
      state?: string;
      error?: string;
      errorDescription?: string;
    };
  };
  authFlow: {
    publish: (instruction: RuntimeAuthFlowInstruction) => Promise<void>;
  };
  runtime: {
    now: () => number;
  };
}

export type AuthMethod = {
  id: string;
  type: AuthMethodType;
  label: string;
  fields?: AuthField[];
  authorize: (ctx: PluginAuthorizeContext) => Promise<AuthResult>;
};

export type RuntimeAuthMethod = {
  id: string;
  type: AuthMethodType;
  label: string;
  fields?: AuthField[];
};

export interface ResolvedAuthMethod {
  pluginID: string;
  pluginMethodID: string;
  method: RuntimeAuthMethod;
  pluginMethod: AuthMethod;
  plugin: RuntimePlugin;
}

export interface AuthContext {
  providerID: string;
  provider: ProviderRuntimeInfo;
  auth?: AuthRecord;
}

export interface ProviderPatchContext {
  providerID: string;
  provider?: ProviderRuntimeInfo;
  auth?: AuthRecord;
}

export interface ChatTransformContext {
  providerID: string;
  modelID: string;
  origin: string;
  sessionID: string;
  requestID: string;
  auth?: AuthRecord;
}

export type RuntimeProviderSDK = {
  languageModel: (modelID: string) => LanguageModelV3;
  chat?: (modelID: string) => LanguageModelV3;
  responses?: (modelID: string) => LanguageModelV3;
  [key: string]: unknown;
};

export type RuntimeProviderFactory = (
  options: Record<string, unknown>,
) => RuntimeProviderSDK;

export type RuntimeTransportAuthType = "bearer" | "api-key";

export interface RuntimeTransportConfig {
  baseURL?: string;
  apiKey?: string;
  authType?: RuntimeTransportAuthType;
  headers: Record<string, string>;
  metadata: Record<string, unknown>;
  fetch?: typeof fetch;
}

export interface RuntimeFactoryConfig {
  npm: string;
  factory: RuntimeProviderFactory;
}

export interface RuntimeAdapterContext extends ChatTransformContext {
  provider: ProviderRuntimeInfo;
  model: ProviderModelInfo;
}

export interface RuntimeAdapterState {
  factory: RuntimeFactoryConfig;
  transport: RuntimeTransportConfig;
  cacheKeyParts: Record<string, unknown>;
}

export interface RuntimeAdapterValidationState extends RuntimeAdapterState {
  factoryOptions: Record<string, unknown>;
}

export interface AuthLoaderResult {
  requestOptions?: Record<string, unknown>;
  transport?: Partial<RuntimeTransportConfig>;
}

export interface LoadedAuthOptions {
  requestOptions: Record<string, unknown>;
  transport: Partial<RuntimeTransportConfig>;
}

export interface HookResultMerge {
  strategy: "merge";
  value: Record<string, unknown>;
}

function toHeaderRecord(value: unknown) {
  if (!isObject(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") continue;
    headers[key] = item;
  }
  return headers;
}

function toRecord(value: unknown) {
  if (!isObject(value)) return {};
  return value;
}

function hasOwn<T extends object>(value: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function mergeTransportPatch(
  base: Partial<RuntimeTransportConfig>,
  patch: Partial<RuntimeTransportConfig>,
): Partial<RuntimeTransportConfig> {
  const next: Partial<RuntimeTransportConfig> = {
    ...base,
  };

  if (hasOwn(patch, "baseURL")) {
    next.baseURL = patch.baseURL;
  }

  if (hasOwn(patch, "apiKey")) {
    next.apiKey = patch.apiKey;
  }

  if (hasOwn(patch, "authType")) {
    next.authType = patch.authType;
  }

  if (hasOwn(patch, "fetch")) {
    next.fetch = patch.fetch;
  }

  const patchHeaders = toHeaderRecord(patch.headers);
  if (Object.keys(patchHeaders).length > 0) {
    next.headers = {
      ...(next.headers ?? {}),
      ...patchHeaders,
    };
  }

  const patchMetadata = toRecord(patch.metadata);
  if (Object.keys(patchMetadata).length > 0) {
    next.metadata = mergeRecord(
      (next.metadata ?? {}) as Record<string, unknown>,
      patchMetadata,
    );
  }

  return next;
}

function mergeTransport(
  base: RuntimeTransportConfig,
  patch: Partial<RuntimeTransportConfig>,
): RuntimeTransportConfig {
  const next: RuntimeTransportConfig = {
    ...base,
    headers: {
      ...base.headers,
    },
    metadata: mergeRecord({}, base.metadata),
  };

  if (hasOwn(patch, "baseURL")) {
    next.baseURL = patch.baseURL;
  }

  if (hasOwn(patch, "apiKey")) {
    next.apiKey = patch.apiKey;
  }

  if (hasOwn(patch, "authType")) {
    next.authType = patch.authType;
  }

  if (hasOwn(patch, "fetch")) {
    next.fetch = patch.fetch;
  }

  const patchHeaders = toHeaderRecord(patch.headers);
  if (Object.keys(patchHeaders).length > 0) {
    next.headers = {
      ...next.headers,
      ...patchHeaders,
    };
  }

  const patchMetadata = toRecord(patch.metadata);
  if (Object.keys(patchMetadata).length > 0) {
    next.metadata = mergeRecord(next.metadata, patchMetadata);
  }

  return next;
}

export interface PluginHooks {
  auth?: {
    provider?: string | "*";
    methods?: (ctx: AuthContext) => Promise<AuthMethod[]>;
    loader?: (
      auth: AuthRecord | undefined,
      provider: ProviderRuntimeInfo,
      ctx: AuthContext,
    ) => Promise<AuthLoaderResult | void>;
  };
  provider?: {
    patchProvider?: (
      ctx: ProviderPatchContext,
      provider: ProviderInfo,
    ) => Promise<ProviderInfo | void>;
    patchModel?: (
      ctx: ProviderPatchContext,
      model: ProviderModelInfo,
    ) => Promise<ProviderModelInfo | void>;
    requestOptions?: (
      ctx: ChatTransformContext,
      options: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | HookResultMerge | void>;
  };
  adapter?: {
    resolveFactory?: (
      ctx: RuntimeAdapterContext,
      currentFactory: RuntimeFactoryConfig,
    ) => Promise<RuntimeFactoryConfig | void>;
    patchTransport?: (
      ctx: RuntimeAdapterContext,
      transport: RuntimeTransportConfig,
    ) => Promise<Partial<RuntimeTransportConfig> | void>;
    patchFactoryOptions?: (
      ctx: RuntimeAdapterContext,
      options: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | void>;
    cacheKeyParts?: (
      ctx: RuntimeAdapterContext,
      currentParts: Record<string, unknown>,
      state: RuntimeAdapterState,
    ) => Promise<Record<string, unknown> | void>;
    validate?: (
      ctx: RuntimeAdapterContext,
      state: RuntimeAdapterValidationState,
    ) => Promise<void>;
  };
  chat?: {
    params?: (
      ctx: ChatTransformContext,
      params: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | HookResultMerge | void>;
    headers?: (
      ctx: ChatTransformContext,
      headers: Record<string, string>,
    ) => Promise<Record<string, string> | HookResultMerge | void>;
    transformRequest?: (
      ctx: ChatTransformContext,
      body: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | void>;
    transformResponse?: (
      ctx: ChatTransformContext,
      body: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | void>;
  };
  tool?: {
    list?: (
      ctx: ChatTransformContext,
    ) => Promise<
      Array<{
        id: string;
        description: string;
        parameters: Record<string, unknown>;
      }>
    >;
  };
  event?: {
    onEvent?: (name: string, payload: Record<string, unknown>) => Promise<void>;
  };
  config?: {
    extend?: (config: RuntimeConfig) => Promise<RuntimeConfig | void>;
    validate?: (config: RuntimeConfig) => Promise<void>;
  };
}

export interface RuntimePlugin {
  id: string;
  name: string;
  supportedProviders?: string[];
  hooks: PluginHooks;
}

function supportsProvider(plugin: RuntimePlugin, providerID: string) {
  if (!plugin.supportedProviders || plugin.supportedProviders.length === 0)
    return true;
  return plugin.supportedProviders.includes(providerID);
}

function supportsAuthProvider(plugin: RuntimePlugin, providerID: string) {
  const authProvider = plugin.hooks.auth?.provider;
  if (authProvider === "*") return true;
  if (typeof authProvider === "string") return authProvider === providerID;
  return supportsProvider(plugin, providerID);
}

function isMergeResult(value: unknown): value is HookResultMerge {
  return isObject(value) && value.strategy === "merge" && isObject(value.value);
}

function mergeObjects<T extends Record<string, unknown>>(
  base: T,
  value: Record<string, unknown>,
) {
  return {
    ...base,
    ...value,
  } as T;
}

function normalizeAuthMethod(method: AuthMethod): AuthMethod {
  const id = method.id.trim();
  if (!id) {
    throw new Error("Auth method id is required");
  }

  return {
    ...method,
    id,
    label: method.label.trim() || id,
  };
}

function toRuntimeAuthMethod(
  pluginID: string,
  method: AuthMethod,
): RuntimeAuthMethod {
  return {
    id: `${pluginID}:${method.id}`,
    type: method.type,
    label: method.label,
    fields: method.fields,
  };
}

export class PluginManager {
  readonly plugins: RuntimePlugin[];

  constructor(plugins: RuntimePlugin[]) {
    this.plugins = plugins;
  }

  private providerPlugins(providerID: string) {
    return this.plugins.filter((plugin) =>
      supportsProvider(plugin, providerID),
    );
  }

  async listResolvedAuthMethods(ctx: AuthContext) {
    const resolvedMethods: ResolvedAuthMethod[] = [];
    const seen = new Set<string>();

    for (const plugin of this.plugins) {
      if (!supportsAuthProvider(plugin, ctx.providerID)) continue;

      try {
        const methods = await plugin.hooks.auth?.methods?.(ctx);
        if (!methods || methods.length === 0) continue;

        for (const rawMethod of methods) {
          const pluginMethod = normalizeAuthMethod(rawMethod);
          const method = toRuntimeAuthMethod(plugin.id, pluginMethod);
          if (seen.has(method.id)) {
            throw new Error(`Duplicate auth method id: ${method.id}`);
          }
          seen.add(method.id);

          resolvedMethods.push({
            pluginID: plugin.id,
            pluginMethodID: pluginMethod.id,
            method,
            pluginMethod,
            plugin,
          });
        }
      } catch (error) {
        console.error(`[plugin:${plugin.id}] auth.methods failed`, error);
      }
    }

    return resolvedMethods;
  }

  async listAuthMethods(ctx: AuthContext) {
    const methods = await this.listResolvedAuthMethods(ctx);
    return methods.map((item) => item.method);
  }

  async resolveAuthMethod(ctx: AuthContext, methodID: string) {
    const methods = await this.listResolvedAuthMethods(ctx);
    return methods.find((resolved) => resolved.method.id === methodID);
  }

  async authorize(
    ctx: AuthContext,
    resolved: ResolvedAuthMethod,
    values: Record<string, string>,
    signal?: AbortSignal,
    onInstruction?: (
      instruction: RuntimeAuthFlowInstruction,
    ) => void | Promise<void>,
  ) {
    const result = await resolved.pluginMethod.authorize({
      providerID: ctx.providerID,
      provider: ctx.provider,
      auth: ctx.auth,
      values,
      signal,
      oauth: {
        getRedirectURL(path = "oauth") {
          if (!browser.identity?.getRedirectURL) {
            throw new Error("Browser OAuth flow is unavailable");
          }
          return browser.identity.getRedirectURL(path);
        },
        async launchWebAuthFlow(url: string) {
          if (!browser.identity?.launchWebAuthFlow) {
            throw new Error("Browser OAuth flow is unavailable");
          }

          const callbackUrl = await browser.identity.launchWebAuthFlow({
            url,
            interactive: true,
          });

          if (!callbackUrl) {
            throw new Error("OAuth flow did not return a callback URL");
          }

          return callbackUrl;
        },
        parseCallback(url: string) {
          return parseOAuthCallbackUrl(url);
        },
      },
      authFlow: {
        async publish(instruction) {
          if (!onInstruction) return;
          await onInstruction(instruction);
        },
      },
      runtime: {
        now: () => Date.now(),
      },
    });

    return result;
  }

  async loadAuthOptions(ctx: AuthContext): Promise<LoadedAuthOptions> {
    let requestOptions: Record<string, unknown> = {};
    let transport: Partial<RuntimeTransportConfig> = {
      headers: {},
      metadata: {},
    };

    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.auth?.loader?.(
          ctx.auth,
          ctx.provider,
          ctx,
        );
        if (!result) continue;

        if (result.requestOptions) {
          requestOptions = mergeRecord(requestOptions, result.requestOptions);
        }

        if (result.transport) {
          transport = mergeTransportPatch(transport, result.transport);
        }
      } catch (error) {
        console.error(`[plugin:${plugin.id}] auth.loader failed`, error);
      }
    }

    return {
      requestOptions,
      transport,
    };
  }

  async applyAdapterState(
    ctx: RuntimeAdapterContext,
    state: RuntimeAdapterState,
  ) {
    const next: RuntimeAdapterState = {
      factory: {
        ...state.factory,
      },
      transport: {
        ...state.transport,
        headers: {
          ...state.transport.headers,
        },
        metadata: mergeRecord({}, state.transport.metadata),
      },
      cacheKeyParts: mergeRecord({}, state.cacheKeyParts),
    };

    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const resolved = await plugin.hooks.adapter?.resolveFactory?.(
          ctx,
          next.factory,
        );
        if (resolved) {
          next.factory = resolved;
        }
      } catch (error) {
        console.error(
          `[plugin:${plugin.id}] adapter.resolveFactory failed`,
          error,
        );
      }

      try {
        const transportPatch = await plugin.hooks.adapter?.patchTransport?.(
          ctx,
          next.transport,
        );
        if (transportPatch) {
          next.transport = mergeTransport(next.transport, transportPatch);
        }
      } catch (error) {
        console.error(
          `[plugin:${plugin.id}] adapter.patchTransport failed`,
          error,
        );
      }

      try {
        const cachePatch = await plugin.hooks.adapter?.cacheKeyParts?.(
          ctx,
          next.cacheKeyParts,
          next,
        );
        if (cachePatch) {
          next.cacheKeyParts = mergeRecord(next.cacheKeyParts, cachePatch);
        }
      } catch (error) {
        console.error(
          `[plugin:${plugin.id}] adapter.cacheKeyParts failed`,
          error,
        );
      }
    }

    return next;
  }

  async applyAdapterFactoryOptions(
    ctx: RuntimeAdapterContext,
    options: Record<string, unknown>,
  ) {
    let next = mergeRecord({}, options);

    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const patch = await plugin.hooks.adapter?.patchFactoryOptions?.(
          ctx,
          next,
        );
        if (!patch) continue;
        next = mergeRecord(next, patch);
      } catch (error) {
        console.error(
          `[plugin:${plugin.id}] adapter.patchFactoryOptions failed`,
          error,
        );
      }
    }

    return next;
  }

  async validateAdapterState(
    ctx: RuntimeAdapterContext,
    state: RuntimeAdapterValidationState,
  ) {
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        await plugin.hooks.adapter?.validate?.(ctx, state);
      } catch (error) {
        console.error(`[plugin:${plugin.id}] adapter.validate failed`, error);
        throw error;
      }
    }
  }

  async patchProvider(ctx: ProviderPatchContext, provider: ProviderInfo) {
    let next = provider;
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const patched = await plugin.hooks.provider?.patchProvider?.(ctx, next);
        if (!patched) continue;
        next = patched;
      } catch (error) {
        console.error(
          `[plugin:${plugin.id}] provider.patchProvider failed`,
          error,
        );
      }
    }
    return next;
  }

  async patchModel(ctx: ProviderPatchContext, model: ProviderModelInfo) {
    let next = model;
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const patched = await plugin.hooks.provider?.patchModel?.(ctx, next);
        if (!patched) continue;
        next = patched;
      } catch (error) {
        console.error(
          `[plugin:${plugin.id}] provider.patchModel failed`,
          error,
        );
      }
    }
    return next;
  }

  async applyRequestOptions(
    ctx: ChatTransformContext,
    options: Record<string, unknown>,
  ) {
    let next = { ...options };
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.provider?.requestOptions?.(ctx, next);
        if (!result) continue;
        if (isMergeResult(result)) {
          next = mergeObjects(next, result.value);
          continue;
        }
        next = result;
      } catch (error) {
        console.error(
          `[plugin:${plugin.id}] provider.requestOptions failed`,
          error,
        );
      }
    }
    return next;
  }

  async applyChatParams(
    ctx: ChatTransformContext,
    params: Record<string, unknown>,
  ) {
    let next = { ...params };
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.chat?.params?.(ctx, next);
        if (!result) continue;
        if (isMergeResult(result)) {
          next = mergeObjects(next, result.value);
          continue;
        }
        next = result;
      } catch (error) {
        console.error(`[plugin:${plugin.id}] chat.params failed`, error);
      }
    }
    return next;
  }

  async applyChatHeaders(
    ctx: ChatTransformContext,
    headers: Record<string, string>,
  ) {
    let next = { ...headers };
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.chat?.headers?.(ctx, next);
        if (!result) continue;
        if (isMergeResult(result)) {
          next = mergeObjects(next, result.value as Record<string, string>);
          continue;
        }
        next = result;
      } catch (error) {
        console.error(`[plugin:${plugin.id}] chat.headers failed`, error);
      }
    }
    return next;
  }

  async transformRequest(
    ctx: ChatTransformContext,
    body: Record<string, unknown>,
  ) {
    let next = { ...body };
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.chat?.transformRequest?.(ctx, next);
        if (!result) continue;
        next = result;
      } catch (error) {
        console.error(
          `[plugin:${plugin.id}] chat.transformRequest failed`,
          error,
        );
      }
    }
    return next;
  }

  async transformResponse(
    ctx: ChatTransformContext,
    body: Record<string, unknown>,
  ) {
    let next = { ...body };
    for (const plugin of this.providerPlugins(ctx.providerID)) {
      try {
        const result = await plugin.hooks.chat?.transformResponse?.(ctx, next);
        if (!result) continue;
        next = result;
      } catch (error) {
        console.error(
          `[plugin:${plugin.id}] chat.transformResponse failed`,
          error,
        );
      }
    }
    return next;
  }

  async listTools(ctx: ChatTransformContext) {
    const tools: Array<{
      id: string;
      description: string;
      parameters: Record<string, unknown>;
    }> = [];
    for (const plugin of this.plugins) {
      try {
        const result = await plugin.hooks.tool?.list?.(ctx);
        if (!result || result.length === 0) continue;
        tools.push(...result);
      } catch (error) {
        console.error(`[plugin:${plugin.id}] tool.list failed`, error);
      }
    }
    return tools;
  }

  async emit(name: string, payload: Record<string, unknown>) {
    for (const plugin of this.plugins) {
      try {
        await plugin.hooks.event?.onEvent?.(name, payload);
      } catch (error) {
        console.error(`[plugin:${plugin.id}] event failed`, error);
      }
    }
  }

  async extendConfig(config: RuntimeConfig) {
    let next = { ...config };
    for (const plugin of this.plugins) {
      try {
        const result = await plugin.hooks.config?.extend?.(next);
        if (!result) continue;
        next = result;
      } catch (error) {
        console.error(`[plugin:${plugin.id}] config.extend failed`, error);
      }
    }

    for (const plugin of this.plugins) {
      try {
        await plugin.hooks.config?.validate?.(next);
      } catch (error) {
        console.error(`[plugin:${plugin.id}] config.validate failed`, error);
      }
    }

    return next;
  }
}
