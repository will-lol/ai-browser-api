export {
  RUNTIME_RPC_PORT_NAME,
  type RuntimeAcquireModelInput,
  type RuntimeAuthFlowSnapshot,
  type RuntimeAuthMethod,
  type RuntimeCancelProviderAuthFlowResponse,
  type RuntimeCreatePermissionRequestResponse,
  type RuntimeDismissPermissionRequestResponse,
  type RuntimeDisconnectProviderResponse,
  type RuntimeGenerateResponse,
  type RuntimeModelCallInput,
  type RuntimeModelDescriptor,
  type RuntimeModelSummary,
  type RuntimeOpenProviderAuthWindowResponse,
  type RuntimeOriginState,
  type RuntimePendingRequest,
  type RuntimePermissionDecision,
  type RuntimePermissionEntry,
  type RuntimeProviderSummary,
  type RuntimeRequestPermissionInput,
  type RuntimeResolvePermissionRequestResponse,
  type RuntimeSetOriginEnabledResponse,
  type RuntimeStartProviderAuthFlowResponse,
  type RuntimeStreamPart,
  type RuntimeUpdatePermissionInput,
  type RuntimeUpdatePermissionResponse,
} from "@llm-bridge/contracts"

import type {
  RuntimeAcquireModelInput,
  RuntimeAuthFlowSnapshot,
  RuntimeCancelProviderAuthFlowResponse,
  RuntimeCreatePermissionRequestResponse,
  RuntimeDismissPermissionRequestResponse,
  RuntimeDisconnectProviderResponse,
  RuntimeGenerateResponse,
  RuntimeModelCallInput,
  RuntimeModelDescriptor,
  RuntimeModelSummary,
  RuntimeOpenProviderAuthWindowResponse,
  RuntimeOriginState,
  RuntimePendingRequest,
  RuntimePermissionEntry,
  RuntimeProviderSummary,
  RuntimeRequestPermissionInput,
  RuntimeResolvePermissionRequestResponse,
  RuntimeSetOriginEnabledResponse,
  RuntimeStartProviderAuthFlowResponse,
  RuntimeUpdatePermissionInput,
  RuntimeUpdatePermissionResponse,
  RuntimeStreamPart,
} from "@llm-bridge/contracts"

export interface RuntimeRPCService {
  listProviders(input: { origin: string }): Promise<ReadonlyArray<RuntimeProviderSummary>>
  listModels(input: {
    origin: string
    connectedOnly?: boolean
    providerID?: string
  }): Promise<ReadonlyArray<RuntimeModelSummary>>
  listConnectedModels(input: { origin: string }): Promise<ReadonlyArray<RuntimeModelSummary>>
  getOriginState(input: { origin: string }): Promise<RuntimeOriginState>
  listPermissions(input: { origin: string }): Promise<ReadonlyArray<RuntimePermissionEntry>>
  listPending(input: { origin: string }): Promise<ReadonlyArray<RuntimePendingRequest>>
  openProviderAuthWindow(input: {
    origin: string
    providerID: string
  }): Promise<RuntimeOpenProviderAuthWindowResponse>
  getProviderAuthFlow(input: {
    origin: string
    providerID: string
  }): Promise<{
    providerID: string
    result: RuntimeAuthFlowSnapshot
  }>
  startProviderAuthFlow(input: {
    origin: string
    providerID: string
    methodID: string
    values?: Record<string, string>
  }): Promise<RuntimeStartProviderAuthFlowResponse>
  cancelProviderAuthFlow(input: {
    origin: string
    providerID: string
    reason?: string
  }): Promise<RuntimeCancelProviderAuthFlowResponse>
  disconnectProvider(input: {
    origin: string
    providerID: string
  }): Promise<RuntimeDisconnectProviderResponse>
  updatePermission(
    input: RuntimeUpdatePermissionInput,
  ): Promise<RuntimeSetOriginEnabledResponse | RuntimeUpdatePermissionResponse>
  requestPermission(
    input: RuntimeRequestPermissionInput,
  ): Promise<
    RuntimeCreatePermissionRequestResponse | RuntimeDismissPermissionRequestResponse | RuntimeResolvePermissionRequestResponse
  >
  acquireModel(input: RuntimeAcquireModelInput): Promise<RuntimeModelDescriptor>
  modelDoGenerate(input: RuntimeModelCallInput): Promise<RuntimeGenerateResponse>
  modelDoStream(input: RuntimeModelCallInput): AsyncIterable<RuntimeStreamPart>
  abortModelCall(input: { requestId: string }): Promise<void>
}
