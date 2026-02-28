import type {
  AuthAuthorization,
  AuthMethod,
  PermissionRequest,
  PermissionStatus,
} from "@/lib/runtime/types"

export const RUNTIME_RPC_PORT_NAME = "llm-bridge-runtime-rpc"

export type RuntimePermissionDecision = Extract<PermissionStatus, "allowed" | "denied">

export interface RuntimeProviderSummary {
  id: string
  name: string
  connected: boolean
  env: string[]
  modelCount: number
}

export interface RuntimeModelSummary {
  id: string
  modelId: string
  name: string
  modelName: string
  provider: string
  capabilities: string[]
  connected: boolean
}

export interface RuntimeOriginState {
  origin: string
  enabled: boolean
}

export interface RuntimePermissionEntry {
  modelId: string
  modelName: string
  provider: string
  status: PermissionStatus
  capabilities: string[]
  requestedAt?: number
}

export interface RuntimeConnectProviderResult {
  method: AuthMethod
  connected: boolean
  pending?: boolean
  authorization?: AuthAuthorization
}

export interface RuntimeConnectProviderResponse {
  providerID: string
  result: RuntimeConnectProviderResult
}

export interface RuntimeDisconnectProviderResponse {
  providerID: string
  connected: boolean
}

export type RuntimeUpdatePermissionInput =
  | {
      origin?: string
      mode: "origin"
      enabled: boolean
    }
  | {
      origin?: string
      mode?: "model"
      modelId: string
      status: RuntimePermissionDecision
      capabilities?: string[]
    }

export type RuntimeUpdatePermissionResponse =
  | {
      origin: string
      enabled: boolean
    }
  | {
      origin: string
      modelId: string
      status: RuntimePermissionDecision
    }

export type RuntimeRequestPermissionInput =
  | {
      origin?: string
      action: "resolve"
      requestId: string
      decision: RuntimePermissionDecision
    }
  | {
      origin?: string
      action: "dismiss"
      requestId: string
    }
  | {
      origin?: string
      action?: undefined
      modelId?: string
      modelName?: string
      provider?: string
      capabilities?: string[]
    }

export type RuntimeRequestPermissionResponse =
  | {
      request: PermissionRequest
    }
  | {
      requestId: string
    }
  | {
      requestId: string
      decision: RuntimePermissionDecision
    }

export interface RuntimeInvokeInput {
  origin?: string
  requestId: string
  sessionID?: string
  model: string
  body?: Record<string, unknown>
}

export interface RuntimeInvokeResult {
  stream: false
  response: Record<string, unknown>
  status: number
}

export interface RuntimeRPCService {
  listProviders(input: { origin?: string }): Promise<RuntimeProviderSummary[]>
  listModels(input: {
    origin?: string
    connectedOnly?: boolean
    providerID?: string
  }): Promise<RuntimeModelSummary[]>
  getOriginState(input: { origin?: string }): Promise<RuntimeOriginState>
  listPermissions(input: { origin?: string }): Promise<RuntimePermissionEntry[]>
  listPending(input: { origin?: string }): Promise<PermissionRequest[]>
  getAuthMethods(input: { origin?: string; providerID: string }): Promise<AuthMethod[]>
  connectProvider(input: {
    origin?: string
    providerID: string
    methodID?: string
    values?: Record<string, string>
    code?: string
  }): Promise<RuntimeConnectProviderResponse>
  disconnectProvider(input: {
    origin?: string
    providerID: string
  }): Promise<RuntimeDisconnectProviderResponse>
  updatePermission(input: RuntimeUpdatePermissionInput): Promise<RuntimeUpdatePermissionResponse>
  requestPermission(input: RuntimeRequestPermissionInput): Promise<RuntimeRequestPermissionResponse>
  invoke(input: RuntimeInvokeInput): Promise<RuntimeInvokeResult>
  invokeStream(input: RuntimeInvokeInput): AsyncIterable<string>
  abort(input: { requestId: string }): Promise<void>
}
