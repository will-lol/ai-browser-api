export type PermissionStatus = "allowed" | "denied" | "pending"

export interface PermissionRule {
  modelId: string
  status: PermissionStatus
  capabilities: string[]
  updatedAt: number
}

export interface OriginPermissionState {
  enabled: boolean
  rules: Record<string, PermissionRule>
}

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

export interface RuntimeProviderConfig {
  name?: string
  env?: string[]
  whitelist?: string[]
  blacklist?: string[]
  options?: Record<string, unknown>
  models?: Record<string, Partial<ModelsDevModel> & { disabled?: boolean; variants?: Record<string, Record<string, unknown>> }>
}

export interface RuntimeConfig {
  enabled_providers?: string[]
  disabled_providers?: string[]
  model?: string
  small_model?: string
  provider?: Record<string, RuntimeProviderConfig>
}

export interface RuntimeModelsCache {
  updatedAt: number
  data: Record<string, ModelsDevProvider>
}

export interface RuntimeState {
  version: 2
  modelsCache?: RuntimeModelsCache
  config: RuntimeConfig
  auth: Record<string, AuthRecord>
  permissionsByOrigin: Record<string, OriginPermissionState>
  pendingRequests: PermissionRequest[]
}

export interface ModelCapabilities {
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: {
    text: boolean
    audio: boolean
    image: boolean
    video: boolean
    pdf: boolean
  }
  output: {
    text: boolean
    audio: boolean
    image: boolean
    video: boolean
    pdf: boolean
  }
}

export interface ProviderModelInfo {
  id: string
  providerID: string
  name: string
  family?: string
  status: "alpha" | "beta" | "deprecated" | "active"
  release_date?: string
  api: {
    id: string
    url: string
    npm: string
  }
  cost: {
    input: number
    output: number
    cache: {
      read: number
      write: number
    }
  }
  limit: {
    context: number
    input?: number
    output: number
  }
  options: Record<string, unknown>
  headers: Record<string, string>
  capabilities: ModelCapabilities
  variants?: Record<string, Record<string, unknown>>
}

export interface ProviderInfo {
  id: string
  name: string
  source: "models.dev" | "config" | "plugin"
  env: string[]
  connected: boolean
  options: Record<string, unknown>
  models: Record<string, ProviderModelInfo>
}

export interface ProviderRegistrySnapshot {
  providers: Record<string, ProviderInfo>
  connected: string[]
  defaultModels: Record<string, string>
  generatedAt: number
}

export interface ConnectedProviderState {
  providerID: string
  connected: boolean
  authType?: AuthRecord["type"]
  modelCount: number
}

export type PromptField = {
  key: string
  label: string
  placeholder?: string
  required?: boolean
  secret?: boolean
  description?: string
}

export type AuthMethod =
  | {
      id: string
      type: "api"
      label: string
      prompt: PromptField[]
    }
  | {
      id: string
      type: "oauth"
      label: string
      mode: "browser" | "device"
      prompt?: PromptField[]
    }

export type AuthAuthorization = {
  methodID: string
  mode: "auto" | "code"
  url: string
  instructions?: string
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

export interface GatewayMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
}

export interface GatewayInvokeInput {
  origin: string
  sessionID: string
  requestID: string
  model: string
  stream?: boolean
  headers?: Record<string, string>
  body: Record<string, unknown>
}

export interface GatewayInvokeChunk {
  id: string
  done?: boolean
  error?: string
  data?: string
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
    ) => Promise<AuthAuthorization | AuthResult | void>
    callback?: (
      ctx: AuthContext,
      method: AuthMethod,
      input: { code?: string; callbackUrl?: string },
    ) => Promise<AuthResult | void>
    loader?: (ctx: AuthContext) => Promise<Record<string, unknown>>
  }
  provider?: {
    patchProvider?: (ctx: ProviderPatchContext, provider: ProviderInfo) => Promise<ProviderInfo | void>
    patchModel?: (ctx: ProviderPatchContext, model: ProviderModelInfo) => Promise<ProviderModelInfo | void>
    requestOptions?: (ctx: ChatTransformContext, options: Record<string, unknown>) => Promise<Record<string, unknown> | HookResultMerge | void>
  }
  chat?: {
    params?: (ctx: ChatTransformContext, params: Record<string, unknown>) => Promise<Record<string, unknown> | HookResultMerge | void>
    headers?: (ctx: ChatTransformContext, headers: Record<string, string>) => Promise<Record<string, string> | HookResultMerge | void>
    transformRequest?: (ctx: ChatTransformContext, body: Record<string, unknown>) => Promise<Record<string, unknown> | void>
    transformResponse?: (ctx: ChatTransformContext, body: Record<string, unknown>) => Promise<Record<string, unknown> | void>
  }
  tool?: {
    list?: (ctx: ChatTransformContext) => Promise<Array<{ id: string; description: string; parameters: Record<string, unknown> }>>
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

export interface ModelsDevModel {
  id: string
  name: string
  family?: string
  release_date: string
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  tool_call: boolean
  interleaved?: boolean | { field: "reasoning_content" | "reasoning_details" }
  cost?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
  }
  limit: {
    context: number
    input?: number
    output: number
  }
  modalities?: {
    input: Array<"text" | "audio" | "image" | "video" | "pdf">
    output: Array<"text" | "audio" | "image" | "video" | "pdf">
  }
  options?: Record<string, unknown>
  headers?: Record<string, string>
  provider?: {
    npm?: string
    api?: string
  }
  status?: "alpha" | "beta" | "deprecated"
  variants?: Record<string, Record<string, unknown>>
}

export interface ModelsDevProvider {
  id: string
  name: string
  env: string[]
  api?: string
  npm?: string
  models: Record<string, ModelsDevModel>
}

export type BridgeRequestType =
  | "list-models"
  | "get-state"
  | "request-permission"
  | "invoke"
  | "abort"

export interface BridgeRequestEnvelope {
  source: "llm-bridge-page"
  requestId: string
  type: BridgeRequestType
  payload?: Record<string, unknown>
}

export interface BridgeResponseEnvelope {
  source: "llm-bridge-content"
  requestId: string
  type: "response" | "stream"
  ok: boolean
  payload?: Record<string, unknown>
  error?: string
}

export interface BackgroundRpcMessage {
  type:
    | "runtime.providers.list"
    | "runtime.models.list"
    | "runtime.origin.get"
    | "runtime.permissions.list"
    | "runtime.pending.list"
    | "runtime.connect-provider"
    | "runtime.disconnect-provider"
    | "runtime.update-permission"
    | "runtime.request-permission"
    | "runtime.invoke"
    | "runtime.abort"
    | "runtime.get-auth-methods"
  payload?: Record<string, unknown>
}
