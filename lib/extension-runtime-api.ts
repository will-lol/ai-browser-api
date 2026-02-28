import { browser } from "wxt/browser"
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

async function sendRuntimeMessage(
  type:
    | "runtime.providers.list"
    | "runtime.models.list"
    | "runtime.origin.get"
    | "runtime.permissions.list"
    | "runtime.pending.list"
    | "runtime.get-auth-methods"
    | "runtime.connect-provider"
    | "runtime.disconnect-provider"
    | "runtime.update-permission"
    | "runtime.request-permission",
  payload: Record<string, unknown>,
) {
  const response = await browser.runtime.sendMessage({
    type,
    payload,
  })

  if (!response?.ok) {
    throw new Error(response?.error ?? `Runtime message failed: ${type}`)
  }

  return response.data
}

export async function fetchProviders(origin = currentOrigin()) {
  const data = (await sendRuntimeMessage("runtime.providers.list", {
    origin,
  })) as ExtensionProvider[]

  return data
}

export async function fetchModels(input?: {
  connectedOnly?: boolean
  providerID?: string
  origin?: string
}) {
  const origin = input?.origin ?? currentOrigin()
  const data = (await sendRuntimeMessage("runtime.models.list", {
    origin,
    connectedOnly: input?.connectedOnly === true,
    providerID: input?.providerID,
  })) as AvailableModel[]

  return data
}

export async function fetchOriginState(origin = currentOrigin()) {
  const data = (await sendRuntimeMessage("runtime.origin.get", {
    origin,
  })) as OriginState

  return data
}

export async function fetchPermissions(origin = currentOrigin()) {
  const data = (await sendRuntimeMessage("runtime.permissions.list", {
    origin,
  })) as ModelPermission[]

  return data
}

export async function fetchPendingRequests(origin = currentOrigin()) {
  const data = (await sendRuntimeMessage("runtime.pending.list", {
    origin,
  })) as PermissionRequest[]

  return data
}

export async function fetchProviderAuthMethods(providerID: string, origin = currentOrigin()) {
  const data = (await sendRuntimeMessage("runtime.get-auth-methods", {
    origin,
    providerID,
  })) as AuthMethod[]

  return data
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
  const data = (await sendRuntimeMessage("runtime.connect-provider", {
    providerID: input.providerId,
    methodID: input.method.id,
    values: input.values,
    code: input.code,
    origin: input.origin,
  })) as ConnectProviderResponse

  return data
}

export async function toggleProviderConnection(input: {
  provider: ExtensionProvider
  origin?: string
}) {
  const origin = input.origin ?? currentOrigin()

  if (input.provider.connected) {
    return sendRuntimeMessage("runtime.disconnect-provider", {
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

  return sendRuntimeMessage("runtime.update-permission", {
    mode: "origin",
    enabled: input.enabled,
    origin,
  })
}

export async function createRuntimePermissionRequest(input: {
  request?: Partial<
    Omit<PermissionRequest, "id" | "requestedAt" | "dismissed" | "status">
  >
  origin?: string
}) {
  const request = input.request ?? {}
  const origin = input.origin ?? request.origin ?? currentOrigin()
  const modelId =
    request.modelId ??
    `${request.provider ?? "openai"}/${request.modelName ?? "gpt-4o-mini"}`

  return sendRuntimeMessage("runtime.request-permission", {
    origin,
    modelId,
    modelName: request.modelName,
    provider: request.provider,
    capabilities: request.capabilities,
  })
}

export async function dismissRuntimePermissionRequest(input: {
  requestId: string
  origin?: string
}) {
  const origin = input.origin ?? currentOrigin()

  return sendRuntimeMessage("runtime.request-permission", {
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

  return sendRuntimeMessage("runtime.request-permission", {
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
  const origin = input.origin ?? currentOrigin()

  return sendRuntimeMessage("runtime.update-permission", {
    origin,
    modelId: input.modelId,
    status: input.status,
  })
}
