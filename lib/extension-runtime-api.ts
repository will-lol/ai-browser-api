import { getRuntimeRPC } from "@/lib/runtime/rpc/runtime-rpc-client"
import type {
  RuntimeConnectProviderResponse,
} from "@/lib/runtime/rpc/runtime-rpc-types"
import type {
  AuthAuthorization,
  AuthMethod,
  PermissionRequest,
  PermissionStatus,
} from "@/lib/runtime/types"

export interface ExtensionProvider {
  id: string
  name: string
  connected: boolean
  env: string[]
  modelCount: number
}

export interface ModelPermission {
  modelId: string
  modelName: string
  provider: string
  status: PermissionStatus
  capabilities: string[]
  requestedAt?: number
}

export interface AvailableModel {
  modelId: string
  modelName: string
  provider: string
  capabilities: string[]
  connected: boolean
}

export interface OriginState {
  origin: string
  enabled: boolean
}

export type PermissionDecision = "allowed" | "denied"

type ConnectProviderResult = {
  method: AuthMethod
  connected: boolean
  pending?: boolean
  authorization?: AuthAuthorization
}

type ConnectProviderResponse = {
  providerID: string
  result: ConnectProviderResult
}

export function currentOrigin() {
  if (typeof window === "undefined") return "https://chat.example.com"
  return window.location.origin
}

export async function fetchProviders(origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return (await runtime.listProviders({ origin })) as ExtensionProvider[]
}

export async function fetchModels(input?: {
  connectedOnly?: boolean
  providerID?: string
  origin?: string
}) {
  const origin = input?.origin ?? currentOrigin()
  const runtime = getRuntimeRPC()
  return (await runtime.listModels({
    origin,
    connectedOnly: input?.connectedOnly === true,
    providerID: input?.providerID,
  })) as AvailableModel[]
}

export async function fetchOriginState(origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return (await runtime.getOriginState({ origin })) as OriginState
}

export async function fetchPermissions(origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return (await runtime.listPermissions({ origin })) as ModelPermission[]
}

export async function fetchPendingRequests(origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return (await runtime.listPending({ origin })) as PermissionRequest[]
}

export async function fetchProviderAuthMethods(providerID: string, origin = currentOrigin()) {
  const runtime = getRuntimeRPC()
  return (await runtime.getAuthMethods({
    origin,
    providerID,
  })) as AuthMethod[]
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
  return (await runtime.connectProvider({
    providerID: input.providerId,
    methodID: input.method.id,
    values: input.values,
    code: input.code,
    origin: input.origin,
  })) as RuntimeConnectProviderResponse
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
  const connected = (await connectProviderWithMethod({
    providerId: input.provider.id,
    method,
    values,
    origin,
  })) as ConnectProviderResponse

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
