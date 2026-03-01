import { getRuntimeRPC } from "@/lib/runtime/rpc/runtime-rpc-client"
import type {
  RuntimeAuthFlowSnapshot,
  RuntimeModelSummary,
  RuntimeOriginState,
  RuntimePermissionDecision,
  RuntimePermissionEntry,
  RuntimeProviderSummary,
  RuntimeAuthMethod,
  RuntimeOpenProviderAuthWindowResponse,
  RuntimeStartProviderAuthFlowResponse,
  RuntimeCancelProviderAuthFlowResponse,
} from "@/lib/runtime/rpc/runtime-rpc-types"
import type { PermissionStatus } from "@/lib/runtime/permissions"

export type ExtensionProvider = RuntimeProviderSummary
export type ModelPermission = RuntimePermissionEntry
export type AvailableModel = RuntimeModelSummary
export type OriginState = RuntimeOriginState
export type PermissionDecision = RuntimePermissionDecision
export type ExtensionAuthMethod = RuntimeAuthMethod
export type ExtensionAuthFlowSnapshot = RuntimeAuthFlowSnapshot

export function currentOrigin() {
  if (typeof window === "undefined") return "https://chat.example.com"
  return window.location.origin
}

export async function fetchProviders(origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return runtime.listProviders({ origin })
}

export async function fetchModels(input?: {
  connectedOnly?: boolean
  providerID?: string
  origin?: string
}) {
  const origin = input?.origin ?? currentOrigin()
  const runtime = getRuntimeRPC()
  return runtime.listModels({
    origin,
    connectedOnly: input?.connectedOnly === true,
    providerID: input?.providerID,
  })
}

export async function fetchOriginState(origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return runtime.getOriginState({ origin })
}

export async function fetchPermissions(origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return runtime.listPermissions({ origin })
}

export async function fetchPendingRequests(origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return runtime.listPending({ origin })
}

export async function openRuntimeProviderAuthWindow(input: {
  providerID: string
  origin?: string
}): Promise<RuntimeOpenProviderAuthWindowResponse> {
  const runtime = getRuntimeRPC()
  const origin = input.origin ?? currentOrigin()
  return runtime.openProviderAuthWindow({
    origin,
    providerID: input.providerID,
  })
}

export async function fetchProviderAuthFlow(input: {
  providerID: string
  origin?: string
}) {
  const runtime = getRuntimeRPC()
  const origin = input.origin ?? currentOrigin()
  return runtime.getProviderAuthFlow({
    origin,
    providerID: input.providerID,
  })
}

export async function startRuntimeProviderAuthFlow(input: {
  providerID: string
  methodID: string
  values?: Record<string, string>
  origin?: string
}): Promise<RuntimeStartProviderAuthFlowResponse> {
  const runtime = getRuntimeRPC()
  const origin = input.origin ?? currentOrigin()
  return runtime.startProviderAuthFlow({
    origin,
    providerID: input.providerID,
    methodID: input.methodID,
    values: input.values,
  })
}

export async function cancelRuntimeProviderAuthFlow(input: {
  providerID: string
  reason?: string
  origin?: string
}): Promise<RuntimeCancelProviderAuthFlowResponse> {
  const runtime = getRuntimeRPC()
  const origin = input.origin ?? currentOrigin()
  return runtime.cancelProviderAuthFlow({
    origin,
    providerID: input.providerID,
    reason: input.reason,
  })
}

export async function disconnectRuntimeProvider(input: {
  providerID: string
  origin?: string
}) {
  const origin = input.origin ?? currentOrigin()
  const runtime = getRuntimeRPC()
  return runtime.disconnectProvider({
    providerID: input.providerID,
    origin,
  })
}

export async function setRuntimeOriginEnabled(input: {
  enabled: boolean
  origin?: string
}) {
  const origin = input.origin ?? currentOrigin()
  const runtime = getRuntimeRPC()

  return runtime.updatePermission({
    mode: "origin",
    enabled: input.enabled,
    origin,
  })
}

export async function dismissRuntimePermissionRequest(input: {
  requestId: string
  origin?: string
}) {
  const origin = input.origin ?? currentOrigin()
  const runtime = getRuntimeRPC()

  return runtime.requestPermission({
    action: "dismiss",
    requestId: input.requestId,
    origin,
  })
}

export async function resolveRuntimePermissionRequest(input: {
  requestId: string
  decision: PermissionDecision
  origin?: string
}) {
  const origin = input.origin ?? currentOrigin()
  const runtime = getRuntimeRPC()

  return runtime.requestPermission({
    action: "resolve",
    requestId: input.requestId,
    decision: input.decision,
    origin,
  })
}

export async function updateRuntimeModelPermission(input: {
  modelId: string
  status: PermissionStatus
  origin?: string
}) {
  if (input.status !== "allowed" && input.status !== "denied") {
    throw new Error(`Invalid permission status: ${input.status}`)
  }

  const origin = input.origin ?? currentOrigin()
  const runtime = getRuntimeRPC()

  return runtime.updatePermission({
    origin,
    modelId: input.modelId,
    status: input.status,
  })
}
