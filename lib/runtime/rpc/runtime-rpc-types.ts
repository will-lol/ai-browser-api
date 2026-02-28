export const RUNTIME_RPC_PORT_NAME = "llm-bridge-runtime-rpc"

type QueryService = typeof import("@/lib/runtime/query-service")
type MutationService = typeof import("@/lib/runtime/mutation-service")
type RuntimeService = typeof import("@/lib/runtime/service")

type RuntimeUpdatePermissionArgs = Parameters<MutationService["updateRuntimePermission"]>[0]
type RuntimeSetOriginEnabledArgs = Parameters<MutationService["setRuntimeOriginEnabled"]>[0]
type RuntimeResolvePermissionArgs = Parameters<MutationService["resolveRuntimePermissionRequest"]>[0]
type RuntimeInvokeModelArgs = Parameters<RuntimeService["invokeRuntimeModel"]>[0]

export type RuntimePermissionDecision = RuntimeUpdatePermissionArgs["status"]

export type RuntimeProviderSummary = Awaited<ReturnType<QueryService["listProviders"]>>[number]
export type RuntimeModelSummary = Awaited<ReturnType<QueryService["listModels"]>>[number]
export type RuntimeOriginState = Awaited<ReturnType<QueryService["getOriginState"]>>
export type RuntimePermissionEntry = Awaited<ReturnType<QueryService["listPermissionsForOrigin"]>>[number]
export type RuntimeConnectProviderResponse = Awaited<
  ReturnType<MutationService["connectRuntimeProvider"]>
>
export type RuntimeDisconnectProviderResponse = Awaited<
  ReturnType<MutationService["disconnectRuntimeProvider"]>
>

export type RuntimeUpdatePermissionInput =
  | {
      origin?: string
      mode: "origin"
      enabled: RuntimeSetOriginEnabledArgs["enabled"]
    }
  | {
      origin?: string
      mode?: "model"
      modelId: RuntimeUpdatePermissionArgs["modelId"]
      status: RuntimePermissionDecision
      capabilities?: RuntimeUpdatePermissionArgs["capabilities"]
    }

export type RuntimeUpdatePermissionResponse =
  | Awaited<ReturnType<MutationService["setRuntimeOriginEnabled"]>>
  | Awaited<ReturnType<MutationService["updateRuntimePermission"]>>

export type RuntimeRequestPermissionInput =
  | {
      origin?: string
      action: "resolve"
      requestId: RuntimeResolvePermissionArgs["requestId"]
      decision: RuntimeResolvePermissionArgs["decision"]
    }
  | {
      origin?: string
      action: "dismiss"
      requestId: Parameters<MutationService["dismissRuntimePermissionRequest"]>[0]
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
  | Awaited<ReturnType<MutationService["createRuntimePermissionRequest"]>>
  | Awaited<ReturnType<MutationService["dismissRuntimePermissionRequest"]>>
  | Awaited<ReturnType<MutationService["resolveRuntimePermissionRequest"]>>

export interface RuntimeInvokeInput {
  origin?: RuntimeInvokeModelArgs["origin"]
  requestId: RuntimeInvokeModelArgs["requestID"]
  sessionID?: RuntimeInvokeModelArgs["sessionID"]
  model: RuntimeInvokeModelArgs["model"]
  body?: RuntimeInvokeModelArgs["body"]
}

export type RuntimeInvokeResult = Extract<
  Awaited<ReturnType<RuntimeService["invokeRuntimeModel"]>>,
  { stream: false }
>

export interface RuntimeRPCService {
  listProviders(input: { origin?: string }): Promise<Awaited<ReturnType<QueryService["listProviders"]>>>
  listModels(input: {
    origin?: string
    connectedOnly?: boolean
    providerID?: string
  }): Promise<Awaited<ReturnType<QueryService["listModels"]>>>
  getOriginState(input: { origin?: string }): Promise<Awaited<ReturnType<QueryService["getOriginState"]>>>
  listPermissions(input: { origin?: string }): Promise<Awaited<ReturnType<QueryService["listPermissionsForOrigin"]>>>
  listPending(input: { origin?: string }): Promise<Awaited<ReturnType<QueryService["listPendingRequestsForOrigin"]>>>
  getAuthMethods(input: {
    origin?: string
    providerID: string
  }): Promise<Awaited<ReturnType<QueryService["listProviderAuthMethods"]>>>
  connectProvider(input: {
    origin?: string
    providerID: string
    methodID?: string
    values?: Record<string, string>
    code?: string
  }): Promise<Awaited<ReturnType<MutationService["connectRuntimeProvider"]>>>
  disconnectProvider(input: {
    origin?: string
    providerID: string
  }): Promise<Awaited<ReturnType<MutationService["disconnectRuntimeProvider"]>>>
  updatePermission(input: RuntimeUpdatePermissionInput): Promise<RuntimeUpdatePermissionResponse>
  requestPermission(input: RuntimeRequestPermissionInput): Promise<RuntimeRequestPermissionResponse>
  invoke(input: RuntimeInvokeInput): Promise<RuntimeInvokeResult>
  invokeStream(input: RuntimeInvokeInput): AsyncIterable<string>
  abort(input: { requestId: string }): Promise<void>
}
