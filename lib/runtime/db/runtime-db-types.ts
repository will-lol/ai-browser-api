import type {
  AuthRecord,
} from "@/lib/runtime/auth-store"
import type { RuntimeConfig } from "@/lib/runtime/config-store"
import type { PermissionRequest, PermissionStatus } from "@/lib/runtime/permissions"
import type { ProviderInfo, ProviderModelInfo } from "@/lib/runtime/provider-registry"

export interface RuntimeDbProvider {
  id: string
  name: string
  source: ProviderInfo["source"]
  env: string[]
  connected: boolean
  options: Record<string, unknown>
  modelCount: number
  updatedAt: number
}

export interface RuntimeDbModel {
  id: string
  providerID: string
  modelID: string
  name: string
  status: ProviderModelInfo["status"]
  capabilities: string[]
  info: ProviderModelInfo
  updatedAt: number
}

export interface RuntimeDbAuth {
  providerID: string
  record: AuthRecord
  updatedAt: number
}

export interface RuntimeDbOrigin {
  origin: string
  enabled: boolean
  updatedAt: number
}

export interface RuntimeDbPermission {
  id: string
  origin: string
  modelId: string
  status: PermissionStatus
  capabilities: string[]
  updatedAt: number
}

export interface RuntimeDbPendingRequest {
  id: string
  origin: string
  modelId: string
  modelName: string
  provider: string
  capabilities: string[]
  requestedAt: number
  dismissed: boolean
  status: PermissionRequest["status"]
}

export interface RuntimeDbMeta {
  key: string
  value: unknown
  updatedAt: number
}

export interface RuntimeDbConfig {
  id: "runtime-config"
  value: RuntimeConfig
  updatedAt: number
}

export function runtimeModelKey(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

export function runtimePermissionKey(origin: string, modelId: string) {
  return `${origin}::${modelId}`
}
