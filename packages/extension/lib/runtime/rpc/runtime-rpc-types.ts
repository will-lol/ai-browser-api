import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"

export const RUNTIME_RPC_PORT_NAME = "llm-bridge-runtime-rpc"

type QueryService = typeof import("@/lib/runtime/query-service")
type MutationService = typeof import("@/lib/runtime/mutation-service")
type RuntimeService = typeof import("@/lib/runtime/service")

type RuntimeUpdatePermissionArgs = Parameters<MutationService["updateRuntimePermission"]>[0]
type RuntimeSetOriginEnabledArgs = Parameters<MutationService["setRuntimeOriginEnabled"]>[0]
type RuntimeResolvePermissionArgs = Parameters<MutationService["resolveRuntimePermissionRequest"]>[0]
type RuntimeAcquireModelArgs = Parameters<RuntimeService["acquireRuntimeModel"]>[0]
type RuntimeGenerateModelArgs = Parameters<RuntimeService["generateRuntimeModel"]>[0]

export type RuntimePermissionDecision = RuntimeUpdatePermissionArgs["status"]

export type RuntimeProviderSummary = Awaited<ReturnType<QueryService["listProviders"]>>[number]
export type RuntimeModelSummary = Awaited<ReturnType<QueryService["listModels"]>>[number]
export type RuntimeOriginState = Awaited<ReturnType<QueryService["getOriginState"]>>
export type RuntimePermissionEntry = Awaited<ReturnType<QueryService["listPermissionsForOrigin"]>>[number]
export type RuntimeAuthFlowSnapshot = Awaited<
  ReturnType<MutationService["getRuntimeProviderAuthFlow"]>
>["result"]
export type RuntimeAuthMethod = RuntimeAuthFlowSnapshot["methods"][number]
export type RuntimeOpenProviderAuthWindowResponse = Awaited<
  ReturnType<MutationService["openRuntimeProviderAuthWindow"]>
>
export type RuntimeStartProviderAuthFlowResponse = Awaited<
  ReturnType<MutationService["startRuntimeProviderAuthFlow"]>
>
export type RuntimeCancelProviderAuthFlowResponse = Awaited<
  ReturnType<MutationService["cancelRuntimeProviderAuthFlow"]>
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

export interface RuntimeAcquireModelInput {
  origin?: RuntimeAcquireModelArgs["origin"]
  requestId: RuntimeAcquireModelArgs["requestID"]
  sessionID?: RuntimeAcquireModelArgs["sessionID"]
  modelId: RuntimeAcquireModelArgs["model"]
}

export type RuntimeAcquireModelResult = Awaited<ReturnType<RuntimeService["acquireRuntimeModel"]>>

export interface RuntimeModelCallInput {
  origin?: RuntimeGenerateModelArgs["origin"]
  requestId: RuntimeGenerateModelArgs["requestID"]
  sessionID?: RuntimeGenerateModelArgs["sessionID"]
  modelId: RuntimeGenerateModelArgs["model"]
  options: RuntimeGenerateModelArgs["options"]
}

export interface RuntimeRPCService {
  listProviders(input: { origin?: string }): Promise<Awaited<ReturnType<QueryService["listProviders"]>>>
  listModels(input: {
    origin?: string
    connectedOnly?: boolean
    providerID?: string
  }): Promise<Awaited<ReturnType<QueryService["listModels"]>>>
  listConnectedModels(input: { origin?: string }): Promise<Awaited<ReturnType<QueryService["listModels"]>>>
  getOriginState(input: { origin?: string }): Promise<Awaited<ReturnType<QueryService["getOriginState"]>>>
  listPermissions(input: { origin?: string }): Promise<Awaited<ReturnType<QueryService["listPermissionsForOrigin"]>>>
  listPending(input: { origin?: string }): Promise<Awaited<ReturnType<QueryService["listPendingRequestsForOrigin"]>>>
  openProviderAuthWindow(input: {
    origin?: string
    providerID: string
  }): Promise<Awaited<ReturnType<MutationService["openRuntimeProviderAuthWindow"]>>>
  getProviderAuthFlow(input: {
    origin?: string
    providerID: string
  }): Promise<Awaited<ReturnType<MutationService["getRuntimeProviderAuthFlow"]>>>
  startProviderAuthFlow(input: {
    origin?: string
    providerID: string
    methodID: string
    values?: Record<string, string>
  }): Promise<Awaited<ReturnType<MutationService["startRuntimeProviderAuthFlow"]>>>
  cancelProviderAuthFlow(input: {
    origin?: string
    providerID: string
    reason?: string
  }): Promise<Awaited<ReturnType<MutationService["cancelRuntimeProviderAuthFlow"]>>>
  disconnectProvider(input: {
    origin?: string
    providerID: string
  }): Promise<Awaited<ReturnType<MutationService["disconnectRuntimeProvider"]>>>
  updatePermission(input: RuntimeUpdatePermissionInput): Promise<RuntimeUpdatePermissionResponse>
  requestPermission(input: RuntimeRequestPermissionInput): Promise<RuntimeRequestPermissionResponse>
  acquireModel(input: RuntimeAcquireModelInput): Promise<RuntimeAcquireModelResult>
  modelDoGenerate(input: RuntimeModelCallInput): Promise<LanguageModelV3GenerateResult>
  modelDoStream(input: RuntimeModelCallInput): AsyncIterable<LanguageModelV3StreamPart>
  abortModelCall(input: { requestId: string }): Promise<void>
}
