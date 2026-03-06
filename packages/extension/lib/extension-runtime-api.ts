import { getRuntimeAdminRPC } from "@/lib/runtime/rpc/runtime-admin-rpc-client"
import type {
  RuntimeAuthFlowSnapshot,
  RuntimePermissionDecision,
  RuntimeModelSummary,
  RuntimeOriginState,
  RuntimePermissionEntry,
  RuntimeProviderSummary,
  RuntimeAuthMethod,
} from "@llm-bridge/contracts"

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

export async function fetchProviders() {
  const runtime = getRuntimeAdminRPC()
  return runtime.listProviders({})
}

export async function fetchModels(input?: {
  connectedOnly?: boolean
  providerID?: string
}) {
  const runtime = getRuntimeAdminRPC()
  return runtime.listModels({
    connectedOnly: input?.connectedOnly,
    providerID: input?.providerID,
  })
}

export async function fetchOriginState(origin = currentOrigin()) {
  const runtime = getRuntimeAdminRPC()
  return runtime.getOriginState({ origin })
}

export async function fetchPermissions(origin = currentOrigin()) {
  const runtime = getRuntimeAdminRPC()
  return runtime.listPermissions({ origin })
}

export async function fetchPendingRequests(origin = currentOrigin()) {
  const runtime = getRuntimeAdminRPC()
  return runtime.listPending({ origin })
}

export async function openRuntimeProviderAuthWindow(input: {
  providerID: string
}) {
  const runtime = getRuntimeAdminRPC()
  return runtime.openProviderAuthWindow({
    providerID: input.providerID,
  })
}

export async function fetchProviderAuthFlow(input: {
  providerID: string
}) {
  const runtime = getRuntimeAdminRPC()
  return runtime.getProviderAuthFlow({
    providerID: input.providerID,
  })
}

export async function startRuntimeProviderAuthFlow(input: {
  providerID: string
  methodID: string
  values?: Record<string, string>
}) {
  const runtime = getRuntimeAdminRPC()
  return runtime.startProviderAuthFlow({
    providerID: input.providerID,
    methodID: input.methodID,
    values: input.values,
  })
}

export async function cancelRuntimeProviderAuthFlow(input: {
  providerID: string
  reason?: string
}) {
  const runtime = getRuntimeAdminRPC()
  return runtime.cancelProviderAuthFlow({
    providerID: input.providerID,
    reason: input.reason,
  })
}

export async function disconnectRuntimeProvider(input: {
  providerID: string
}) {
  const runtime = getRuntimeAdminRPC()
  return runtime.disconnectProvider({
    providerID: input.providerID,
  })
}

export async function setRuntimeOriginEnabled(input: {
  enabled: boolean
  origin?: string
}) {
  const origin = input.origin ?? currentOrigin()
  const runtime = getRuntimeAdminRPC()

  return runtime.updatePermission({
    mode: "origin",
    enabled: input.enabled,
    origin,
  })
}

export async function dismissRuntimePermissionRequest(input: {
  requestId: string
}) {
  const runtime = getRuntimeAdminRPC()

  return runtime.requestPermission({
    action: "dismiss",
    requestId: input.requestId,
  })
}

export async function resolveRuntimePermissionRequest(input: {
  requestId: string
  decision: PermissionDecision
}) {
  const runtime = getRuntimeAdminRPC()

  return runtime.requestPermission({
    action: "resolve",
    requestId: input.requestId,
    decision: input.decision,
  })
}

export async function updateRuntimeModelPermission(input: {
  modelId: string
  status: RuntimePermissionDecision
  origin?: string
}) {
  const origin = input.origin ?? currentOrigin()
  const runtime = getRuntimeAdminRPC()

  return runtime.updatePermission({
    origin,
    mode: "model",
    modelId: input.modelId,
    status: input.status,
  })
}
