export type SerializedSupportedUrlPattern = {
  source: string
  flags?: string
}

export type BridgeProviderModel = {
  id: string
  name: string
  capabilities?: unknown
}

export type BridgeProviderState = {
  id: string
  name: string
  connected: boolean
  env?: unknown
  authMethods: unknown[]
  models: BridgeProviderModel[]
}

export type BridgeStateResponse = {
  providers: BridgeProviderState[]
  permissions: unknown[]
  pendingRequests: unknown[]
  originEnabled: boolean
  currentOrigin: string
}

export type BridgeConnectedModel = {
  id: string
  name: string
  provider: string
  capabilities?: unknown
  connected?: boolean
}

export type BridgeListModelsResponse = {
  models: BridgeConnectedModel[]
}

export type BridgeModelDescriptorResponse = {
  specificationVersion: "v3"
  provider: string
  modelId: string
  supportedUrls: Record<string, SerializedSupportedUrlPattern[]>
}

export type BridgeModelRequest = {
  modelId: string
  requestId?: string
  sessionID?: string
}

export type BridgeModelCallRequest = {
  requestId?: string
  sessionID?: string
  modelId: string
  options?: Record<string, unknown>
}

export type BridgePermissionRequest = {
  modelId?: string
  modelName?: string
  provider?: string
  capabilities?: string[]
}

export type BridgeAbortRequest = {
  requestId?: string
}

export type PageBridgeService = {
  getState: () => Promise<BridgeStateResponse>
  listModels: () => Promise<BridgeListModelsResponse>
  getModel: (input: BridgeModelRequest) => Promise<BridgeModelDescriptorResponse>
  requestPermission: (input: BridgePermissionRequest) => Promise<unknown>
  abort: (input: BridgeAbortRequest) => Promise<{ ok: true }>
  modelDoGenerate: (input: BridgeModelCallRequest) => Promise<unknown>
  modelDoStream: (input: BridgeModelCallRequest) => AsyncIterable<unknown>
}
