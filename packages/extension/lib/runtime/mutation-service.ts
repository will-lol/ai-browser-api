import {
  disconnectProvider,
} from "@/lib/runtime/provider-auth"
import { getAuthFlowManager } from "@/lib/runtime/auth-flow-manager"
import {
  createPermissionRequest,
  dismissPermissionRequest,
  resolvePermissionRequest,
  setModelPermission,
  setOriginEnabled,
} from "@/lib/runtime/permissions"
import { refreshProviderCatalogForProvider } from "@/lib/runtime/provider-registry"

export async function openRuntimeProviderAuthWindow(providerID: string) {
  const manager = getAuthFlowManager()
  const result = await manager.openProviderAuthWindow(providerID)
  return {
    providerID,
    result,
  }
}

export async function getRuntimeProviderAuthFlow(providerID: string) {
  const manager = getAuthFlowManager()
  const result = await manager.getProviderAuthFlow(providerID)
  return {
    providerID,
    result,
  }
}

export async function startRuntimeProviderAuthFlow(input: {
  providerID: string
  methodID: string
  values?: Record<string, string>
}) {
  const manager = getAuthFlowManager()
  const result = await manager.startProviderAuthFlow(input)
  return {
    providerID: input.providerID,
    result,
  }
}

export async function cancelRuntimeProviderAuthFlow(input: {
  providerID: string
  reason?: string
}) {
  const manager = getAuthFlowManager()
  const result = await manager.cancelProviderAuthFlow(input)
  return {
    providerID: input.providerID,
    result,
  }
}

export async function disconnectRuntimeProvider(providerID: string) {
  const manager = getAuthFlowManager()
  await manager.cancelProviderAuthFlow({
    providerID,
    reason: "disconnect",
  }).catch(() => {
    // Ignore cancellation failures and continue disconnecting stored auth.
  })

  await disconnectProvider(providerID)
  await refreshProviderCatalogForProvider(providerID)

  return {
    providerID,
    connected: false,
  }
}

export async function setRuntimeOriginEnabled(input: { origin: string; enabled: boolean }) {
  await setOriginEnabled(input.origin, input.enabled)

  return {
    origin: input.origin,
    enabled: input.enabled,
  }
}

export async function updateRuntimePermission(input: {
  origin: string
  modelId: string
  status: "allowed" | "denied"
  capabilities?: string[]
}) {
  await setModelPermission(input.origin, input.modelId, input.status, input.capabilities)

  return {
    origin: input.origin,
    modelId: input.modelId,
    status: input.status,
  }
}

export async function createRuntimePermissionRequest(input: {
  origin: string
  modelId: string
  provider: string
  modelName: string
  capabilities?: string[]
}) {
  const request = await createPermissionRequest(input)
  return {
    request,
  }
}

export async function resolveRuntimePermissionRequest(input: {
  requestId: string
  decision: "allowed" | "denied"
}) {
  await resolvePermissionRequest(input.requestId, input.decision)
  return {
    requestId: input.requestId,
    decision: input.decision,
  }
}

export async function dismissRuntimePermissionRequest(requestId: string) {
  await dismissPermissionRequest(requestId)
  return {
    requestId,
  }
}
