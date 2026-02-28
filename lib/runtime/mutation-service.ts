import {
  connectProvider,
  disconnectProvider,
} from "@/lib/runtime/provider-auth"
import {
  createPermissionRequest,
  dismissPermissionRequest,
  resolvePermissionRequest,
  setModelPermission,
  setOriginEnabled,
} from "@/lib/runtime/permissions"
import { refreshProviderCatalogForProvider } from "@/lib/runtime/provider-registry"

export async function connectRuntimeProvider(input: {
  providerID: string
  methodID?: string
  values?: Record<string, string>
  code?: string
}) {
  const result = await connectProvider(input)

  if (result.connected) {
    await refreshProviderCatalogForProvider(input.providerID)
  }

  return {
    providerID: input.providerID,
    result,
  }
}

export async function disconnectRuntimeProvider(providerID: string) {
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
