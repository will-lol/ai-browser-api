import { getRuntimeRPC } from "@/lib/runtime/rpc/runtime-rpc-client"
import type {
  RuntimeModelSummary,
  RuntimeOriginState,
  RuntimePermissionDecision,
  RuntimePermissionEntry,
  RuntimeProviderSummary,
} from "@/lib/runtime/rpc/runtime-rpc-types"
import type { AuthMethod } from "@/lib/runtime/plugin-manager"
import type { PermissionStatus } from "@/lib/runtime/permissions"

export type ExtensionProvider = RuntimeProviderSummary
export type ModelPermission = RuntimePermissionEntry
export type AvailableModel = RuntimeModelSummary
export type OriginState = RuntimeOriginState
export type PermissionDecision = RuntimePermissionDecision

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

export async function fetchProviderAuthMethods(providerID: string, origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return runtime.getAuthMethods({
    origin,
    providerID,
  })
}

async function promptAuthValues(method: AuthMethod) {
  const prompts = method.type === "api" ? method.prompt : method.prompt ?? []
  const values: Record<string, string> = {}

  for (const prompt of prompts) {
    const value = window.prompt(prompt.label, "")
    if (!value && prompt.required) {
      throw new Error(`${prompt.label} is required`)
    }
    values[prompt.key] = value ?? ""
  }

  return values
}

async function connectProviderWithMethod(input: {
  providerId: string
  method: AuthMethod
  values: Record<string, string>
  code?: string
  origin: string
}) {
  const runtime = getRuntimeRPC()
  return runtime.connectProvider({
    providerID: input.providerId,
    methodID: input.method.id,
    values: input.values,
    code: input.code,
    origin: input.origin,
  })
}

export async function toggleProviderConnection(input: {
  provider: ExtensionProvider
  origin?: string
}) {
  const origin = input.origin ?? currentOrigin()
  const runtime = getRuntimeRPC()

  if (input.provider.connected) {
    return runtime.disconnectProvider({
      providerID: input.provider.id,
      origin,
    })
  }

  const methods = await fetchProviderAuthMethods(input.provider.id, origin)
  const method =
    methods.find((item) => item.type === "oauth") ??
    methods.find((item) => item.type === "api") ??
    methods[0]

  if (!method) {
    throw new Error(`No auth method available for provider ${input.provider.id}`)
  }

  const values = await promptAuthValues(method)
  const connected = await connectProviderWithMethod({
    providerId: input.provider.id,
    method,
    values,
    origin,
  })

  if (
    connected.result.pending &&
    method.type === "oauth" &&
    connected.result.authorization?.mode === "code"
  ) {
    const instructions =
      connected.result.authorization.instructions ??
      "Complete provider authorization and paste the code."
    const code = window.prompt(instructions, "")
    if (!code) {
      throw new Error("Authorization code is required")
    }

    return connectProviderWithMethod({
      providerId: input.provider.id,
      method,
      values,
      code,
      origin,
    })
  }

  return connected
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
