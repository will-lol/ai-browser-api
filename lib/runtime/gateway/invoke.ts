import { getAuth } from "@/lib/runtime/auth-store"
import { buildEndpoint, getProviderFormat, type ProviderFormat } from "@/lib/runtime/gateway/formats"
import { toAnthropicRequest, fromAnthropicResponse } from "@/lib/runtime/gateway/normalize/anthropic"
import { toGoogleRequest, fromGoogleResponse } from "@/lib/runtime/gateway/normalize/google"
import { toOpenAIResponsesRequest, fromOpenAIResponsesResponse } from "@/lib/runtime/gateway/normalize/openai"
import { toOpenAICompatibleRequest, fromOpenAICompatibleResponse } from "@/lib/runtime/gateway/normalize/openai-compatible"
import type { ChatTransformContext } from "@/lib/runtime/plugin-manager"
import { getPluginManager } from "@/lib/runtime/plugins"
import { getModel, getProvider } from "@/lib/runtime/provider-registry"
import { isObject, parseProviderModel } from "@/lib/runtime/util"

export interface GatewayInvokeInput {
  origin: string
  sessionID: string
  requestID: string
  model: string
  stream?: boolean
  headers?: Record<string, string>
  body: Record<string, unknown>
}

export type GatewayInvokeResult =
  | {
      stream: false
      response: Record<string, unknown>
      status: number
    }
  | {
      stream: true
      response: Response
      status: number
      format: ProviderFormat
    }

type GatewayTransportOptions = {
  endpoint?: string
  baseURL?: string
  apiKey?: string
  authType?: "bearer" | "api-key"
  headers: Record<string, string>
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function toHeaderRecord(value: unknown) {
  if (!isObject(value)) return {}
  const headers: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") continue
    headers[key] = item
  }
  return headers
}

function splitTransportOptions(input: Record<string, unknown>) {
  const body: Record<string, unknown> = {}
  const transport: GatewayTransportOptions = {
    headers: {},
  }

  for (const [key, value] of Object.entries(input)) {
    if (key === "$endpoint" || key === "endpoint") {
      transport.endpoint = readString(value)
      continue
    }

    if (key === "$baseURL" || key === "baseURL" || key === "$instanceUrl" || key === "instanceUrl") {
      transport.baseURL = readString(value)
      continue
    }

    if (key === "$apiKey" || key === "apiKey") {
      transport.apiKey = readString(value)
      continue
    }

    if (key === "$authType" || key === "authType") {
      const nextAuthType = readString(value)
      if (nextAuthType === "bearer" || nextAuthType === "api-key") {
        transport.authType = nextAuthType
      }
      continue
    }

    if (key === "$headers" || key === "headers") {
      transport.headers = {
        ...transport.headers,
        ...toHeaderRecord(value),
      }
      continue
    }

    if (key.startsWith("$")) {
      continue
    }

    body[key] = value
  }

  return { body, transport }
}

function mergeTransportOptions(base: GatewayTransportOptions, patch: GatewayTransportOptions) {
  return {
    endpoint: patch.endpoint ?? base.endpoint,
    baseURL: patch.baseURL ?? base.baseURL,
    apiKey: patch.apiKey ?? base.apiKey,
    authType: patch.authType ?? base.authType,
    headers: {
      ...base.headers,
      ...patch.headers,
    },
  }
}

function buildHeaders(
  format: ProviderFormat,
  auth: Awaited<ReturnType<typeof getAuth>>,
  transport: GatewayTransportOptions,
) {
  const headers = new Headers()
  headers.set("content-type", "application/json")
  headers.set("accept", "application/json")

  const token = transport.apiKey ?? (auth ? (auth.type === "api" ? auth.key : auth.access) : undefined)
  if (!token) return headers

  if (format === "anthropic") {
    headers.set("x-api-key", token)
    headers.set("anthropic-version", "2023-06-01")
    return headers
  }

  if (format === "google") {
    if (transport.authType === "bearer" || auth?.type === "oauth") {
      headers.set("authorization", `Bearer ${token}`)
    } else {
      headers.set("x-goog-api-key", token)
    }
    return headers
  }

  if (transport.authType === "api-key") {
    headers.set("x-api-key", token)
  } else {
    headers.set("authorization", `Bearer ${token}`)
  }
  return headers
}

function convertRequest(format: ProviderFormat, body: Record<string, unknown>) {
  if (format === "openai") return toOpenAIResponsesRequest(body)
  if (format === "anthropic") return toAnthropicRequest(body)
  if (format === "google") return toGoogleRequest(body)
  return toOpenAICompatibleRequest(body)
}

function convertResponse(format: ProviderFormat, body: Record<string, unknown>) {
  if (format === "openai") return fromOpenAIResponsesResponse(body)
  if (format === "anthropic") return fromAnthropicResponse(body)
  if (format === "google") return fromGoogleResponse(body)
  return fromOpenAICompatibleResponse(body)
}

export async function invokeGateway(input: GatewayInvokeInput, signal?: AbortSignal): Promise<GatewayInvokeResult> {
  const parsed = parseProviderModel(input.model)
  if (!parsed.providerID || !parsed.modelID) throw new Error(`Invalid model: ${input.model}`)

  const [provider, model, auth] = await Promise.all([
    getProvider(parsed.providerID),
    getModel(parsed.providerID, parsed.modelID),
    getAuth(parsed.providerID),
  ])

  if (!provider || !model) {
    throw new Error(`Model not found: ${input.model}`)
  }

  if (!auth) {
    throw new Error(`Provider ${parsed.providerID} is not connected`)
  }

  const plugins = getPluginManager()
  const context: ChatTransformContext = {
    providerID: parsed.providerID,
    modelID: parsed.modelID,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    auth,
  }

  const format = getProviderFormat(model)
  const authOptions = await plugins.loadAuthOptions({
    providerID: parsed.providerID,
    provider,
    auth,
  })

  const requestParams = (await plugins.applyChatParams(context, {
    ...input.body,
    ...authOptions,
    model: model.api.id,
  })) as Record<string, unknown>

  const requestOptions = await plugins.applyRequestOptions(context, requestParams)
  const extractedFromRequest = splitTransportOptions(requestOptions)
  const transformed = await plugins.transformRequest(context, extractedFromRequest.body)
  const extractedFromTransform = splitTransportOptions(transformed)
  const transport = mergeTransportOptions(extractedFromRequest.transport, extractedFromTransform.transport)
  const requestBody = convertRequest(format, extractedFromTransform.body)

  const endpoint = transport.endpoint ?? buildEndpoint(model, format, Boolean(input.stream), transport.baseURL)

  const headers = buildHeaders(format, auth, transport)
  for (const [key, value] of Object.entries(model.headers)) {
    headers.set(key, value)
  }
  for (const [key, value] of Object.entries(transport.headers)) {
    headers.set(key, value)
  }

  const pluginHeaders = await plugins.applyChatHeaders(context, Object.fromEntries(headers.entries()))
  for (const [key, value] of Object.entries(pluginHeaders)) {
    headers.set(key, value)
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal,
  })

  if (!response.ok) {
    const message = await response.text().catch(() => "")
    throw new Error(`Provider request failed (${response.status}): ${message.slice(0, 500)}`)
  }

  if (input.stream) {
    return {
      stream: true,
      response,
      status: response.status,
      format,
    }
  }

  const json = (await response.json()) as Record<string, unknown>
  const normalized = convertResponse(format, await plugins.transformResponse(context, json))
  return {
    stream: false,
    response: normalized,
    status: response.status,
  }
}
