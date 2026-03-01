import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"
import * as amazonBedrockModule from "@ai-sdk/amazon-bedrock"
import * as anthropicModule from "@ai-sdk/anthropic"
import * as azureModule from "@ai-sdk/azure"
import * as cerebrasModule from "@ai-sdk/cerebras"
import * as cohereModule from "@ai-sdk/cohere"
import * as deepInfraModule from "@ai-sdk/deepinfra"
import * as gatewayModule from "@ai-sdk/gateway"
import * as googleModule from "@ai-sdk/google"
import * as groqModule from "@ai-sdk/groq"
import * as mistralModule from "@ai-sdk/mistral"
import * as openAIModule from "@ai-sdk/openai"
import * as openAICompatibleModule from "@ai-sdk/openai-compatible"
import * as perplexityModule from "@ai-sdk/perplexity"
import * as togetherAIModule from "@ai-sdk/togetherai"
import * as vercelModule from "@ai-sdk/vercel"
import * as xaiModule from "@ai-sdk/xai"
import * as openRouterModule from "@openrouter/ai-sdk-provider"
import { getAuth } from "@/lib/runtime/auth-store"
import type { AuthRecord } from "@/lib/runtime/auth-store"
import type { ChatTransformContext } from "@/lib/runtime/plugin-manager"
import { getPluginManager } from "@/lib/runtime/plugins"
import { getModel, getProvider } from "@/lib/runtime/provider-registry"
import type {
  ProviderModelInfo,
  ProviderRuntimeInfo,
} from "@/lib/runtime/provider-registry"
import { isObject, mergeRecord, parseProviderModel } from "@/lib/runtime/util"

export type RuntimeLanguageModelCallOptions = Omit<LanguageModelV3CallOptions, "abortSignal">

interface ModelRuntimeContext {
  providerID: string
  modelID: string
  provider: ProviderRuntimeInfo
  model: ProviderModelInfo
  auth?: AuthRecord
}

type ProviderFactory = (options: Record<string, unknown>) => {
  languageModel: (modelID: string) => LanguageModelV3
  chat?: (modelID: string) => LanguageModelV3
  responses?: (modelID: string) => LanguageModelV3
  [key: string]: unknown
}

type TransportOptions = {
  baseURL?: string
  apiKey?: string
  authType?: "bearer" | "api-key"
  headers: Record<string, string>
}

type PreparedCallOptions = {
  callOptions: RuntimeLanguageModelCallOptions
  transport: TransportOptions
}

const providerSDKCache = new Map<string, ReturnType<ProviderFactory>>()
const languageModelCache = new Map<string, LanguageModelV3>()

function pickFactory(moduleValue: Record<string, unknown>) {
  const match = Object.entries(moduleValue).find(
    ([key, value]) => key.startsWith("create") && typeof value === "function",
  )
  if (!match) {
    throw new Error("Provider module does not export a factory function")
  }
  return match[1] as ProviderFactory
}

const OPENAI_COMPATIBLE_FACTORY = pickFactory(
  openAICompatibleModule as unknown as Record<string, unknown>,
)

const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  "@ai-sdk/amazon-bedrock": pickFactory(
    amazonBedrockModule as unknown as Record<string, unknown>,
  ),
  "@ai-sdk/anthropic": pickFactory(anthropicModule as unknown as Record<string, unknown>),
  "@ai-sdk/azure": pickFactory(azureModule as unknown as Record<string, unknown>),
  "@ai-sdk/cerebras": pickFactory(cerebrasModule as unknown as Record<string, unknown>),
  "@ai-sdk/cohere": pickFactory(cohereModule as unknown as Record<string, unknown>),
  "@ai-sdk/deepinfra": pickFactory(deepInfraModule as unknown as Record<string, unknown>),
  "@ai-sdk/gateway": pickFactory(gatewayModule as unknown as Record<string, unknown>),
  "@ai-sdk/google": pickFactory(googleModule as unknown as Record<string, unknown>),
  "@ai-sdk/groq": pickFactory(groqModule as unknown as Record<string, unknown>),
  "@ai-sdk/mistral": pickFactory(mistralModule as unknown as Record<string, unknown>),
  "@ai-sdk/openai": pickFactory(openAIModule as unknown as Record<string, unknown>),
  "@ai-sdk/openai-compatible": OPENAI_COMPATIBLE_FACTORY,
  "@ai-sdk/perplexity": pickFactory(perplexityModule as unknown as Record<string, unknown>),
  "@ai-sdk/togetherai": pickFactory(togetherAIModule as unknown as Record<string, unknown>),
  "@ai-sdk/vercel": pickFactory(vercelModule as unknown as Record<string, unknown>),
  "@ai-sdk/xai": pickFactory(xaiModule as unknown as Record<string, unknown>),
  "@openrouter/ai-sdk-provider": pickFactory(openRouterModule as unknown as Record<string, unknown>),
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (Array.isArray(nested)) return nested
    if (!isObject(nested)) return nested
    return Object.fromEntries(
      Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)),
    )
  })
}

function getProviderOptionKey(model: ProviderModelInfo) {
  switch (model.api.npm) {
    case "@ai-sdk/openai":
    case "@ai-sdk/azure":
      return "openai"
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return "anthropic"
    case "@ai-sdk/google":
    case "@ai-sdk/google-vertex":
      return "google"
    case "@ai-sdk/amazon-bedrock":
      return "bedrock"
    case "@openrouter/ai-sdk-provider":
      return "openrouter"
    case "@ai-sdk/gateway":
      return "gateway"
    case "@ai-sdk/github-copilot":
      return "copilot"
    default:
      return "openaiCompatible"
  }
}

function isAnthropicPackage(npm: string) {
  return npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic"
}

function isGooglePackage(npm: string) {
  return npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex"
}

function getFactoryForModel(model: ProviderModelInfo) {
  const direct = PROVIDER_FACTORIES[model.api.npm]
  if (direct) return direct

  if (
    model.api.npm === "@gitlab/gitlab-ai-provider" ||
    model.api.npm === "@ai-sdk/google-vertex" ||
    model.api.npm === "@ai-sdk/google-vertex/anthropic"
  ) {
    throw new Error(`Provider SDK package is not supported in browser runtime: ${model.api.npm}`)
  }

  if (model.api.npm === "@ai-sdk/github-copilot") {
    return OPENAI_COMPATIBLE_FACTORY
  }

  if (
    model.api.npm === "ai-gateway-provider" ||
    model.api.npm === "venice-ai-sdk-provider" ||
    model.api.npm === "@jerome-benoit/sap-ai-provider-v2"
  ) {
    return OPENAI_COMPATIBLE_FACTORY
  }

  if (model.api.npm.includes("openai-compatible")) {
    return OPENAI_COMPATIBLE_FACTORY
  }

  throw new Error(`Unsupported provider SDK package: ${model.api.npm}`)
}

function resolveDefaultToken(auth?: AuthRecord) {
  if (!auth) return undefined
  return auth.type === "api" ? auth.key : auth.access
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
  const transport: TransportOptions = {
    headers: {},
  }

  for (const [key, value] of Object.entries(input)) {
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

function toLegacyMessages(prompt: LanguageModelV3CallOptions["prompt"]) {
  return prompt.map((message) => {
    if (message.role === "system") {
      return {
        role: "system",
        content: message.content,
      }
    }

    return {
      role: message.role,
      content: message.content.map((part) => {
        if (part.type === "text") {
          return {
            type: "text",
            text: part.text,
          }
        }

        if (
          part.type === "file" &&
          part.mediaType.startsWith("image/") &&
          (typeof part.data === "string" || part.data instanceof URL)
        ) {
          return {
            type: "image_url",
            image_url: {
              url: typeof part.data === "string" ? part.data : part.data.toString(),
            },
          }
        }

        return part
      }),
    }
  })
}

function toCallOptions(
  raw: Record<string, unknown>,
  fallback: RuntimeLanguageModelCallOptions,
): RuntimeLanguageModelCallOptions {
  const callOptions: RuntimeLanguageModelCallOptions = {
    ...fallback,
  }

  if (Array.isArray(raw.prompt)) {
    callOptions.prompt = raw.prompt as RuntimeLanguageModelCallOptions["prompt"]
  }

  if (typeof raw.maxOutputTokens === "number") {
    callOptions.maxOutputTokens = raw.maxOutputTokens
  } else if (typeof raw.max_tokens === "number") {
    callOptions.maxOutputTokens = raw.max_tokens
  }

  if (typeof raw.temperature === "number") {
    callOptions.temperature = raw.temperature
  }
  if (typeof raw.topP === "number") {
    callOptions.topP = raw.topP
  } else if (typeof raw.top_p === "number") {
    callOptions.topP = raw.top_p
  }
  if (typeof raw.topK === "number") {
    callOptions.topK = raw.topK
  }
  if (typeof raw.presencePenalty === "number") {
    callOptions.presencePenalty = raw.presencePenalty
  }
  if (typeof raw.frequencyPenalty === "number") {
    callOptions.frequencyPenalty = raw.frequencyPenalty
  }
  if (Array.isArray(raw.stopSequences)) {
    callOptions.stopSequences = raw.stopSequences.filter(
      (item): item is string => typeof item === "string",
    )
  } else if (Array.isArray(raw.stop)) {
    callOptions.stopSequences = raw.stop.filter((item): item is string => typeof item === "string")
  }

  if (isObject(raw.responseFormat)) {
    callOptions.responseFormat = raw.responseFormat as RuntimeLanguageModelCallOptions["responseFormat"]
  } else if (isObject(raw.response_format)) {
    callOptions.responseFormat = raw.response_format as RuntimeLanguageModelCallOptions["responseFormat"]
  }

  if (typeof raw.seed === "number") {
    callOptions.seed = raw.seed
  }

  if (Array.isArray(raw.tools)) {
    callOptions.tools = raw.tools as RuntimeLanguageModelCallOptions["tools"]
  }

  if (typeof raw.toolChoice === "string" || isObject(raw.toolChoice)) {
    callOptions.toolChoice = raw.toolChoice as RuntimeLanguageModelCallOptions["toolChoice"]
  } else if (typeof raw.tool_choice === "string" || isObject(raw.tool_choice)) {
    callOptions.toolChoice = raw.tool_choice as RuntimeLanguageModelCallOptions["toolChoice"]
  }

  if (typeof raw.includeRawChunks === "boolean") {
    callOptions.includeRawChunks = raw.includeRawChunks
  }

  if (isObject(raw.providerOptions)) {
    callOptions.providerOptions = raw.providerOptions as RuntimeLanguageModelCallOptions["providerOptions"]
  }

  return callOptions
}

async function resolveModelRuntimeContext(modelID: string): Promise<ModelRuntimeContext> {
  const parsed = parseProviderModel(modelID)
  if (!parsed.providerID || !parsed.modelID) throw new Error(`Invalid model: ${modelID}`)

  const [provider, model, auth] = await Promise.all([
    getProvider(parsed.providerID),
    getModel(parsed.providerID, parsed.modelID),
    getAuth(parsed.providerID),
  ])

  if (!provider || !model) {
    throw new Error(`Model not found: ${modelID}`)
  }

  if (!auth) {
    throw new Error(`Provider ${parsed.providerID} is not connected`)
  }

  return {
    providerID: parsed.providerID,
    modelID: parsed.modelID,
    provider,
    model,
    auth,
  }
}

async function getLanguageModel(
  runtime: ModelRuntimeContext,
  transport: TransportOptions,
  staticHeaders: Record<string, string>,
) {
  const factory = getFactoryForModel(runtime.model)
  const baseURL = transport.baseURL ?? runtime.model.api.url
  const apiKey = transport.apiKey ?? resolveDefaultToken(runtime.auth)
  const authHeaders: Record<string, string> = {}

  if (apiKey && transport.authType === "api-key") {
    authHeaders["x-api-key"] = apiKey
  }

  if (apiKey && transport.authType === "bearer") {
    authHeaders.authorization = `Bearer ${apiKey}`
  }

  if (apiKey && isAnthropicPackage(runtime.model.api.npm)) {
    authHeaders["x-api-key"] = apiKey
    if (!("anthropic-version" in authHeaders)) {
      authHeaders["anthropic-version"] = "2023-06-01"
    }
  }

  if (apiKey && isGooglePackage(runtime.model.api.npm) && transport.authType !== "bearer") {
    authHeaders["x-goog-api-key"] = apiKey
  }

  const options: Record<string, unknown> = {
    name: runtime.providerID,
    baseURL,
    headers: mergeRecord(
      mergeRecord(
        mergeRecord({}, runtime.provider.options as Record<string, unknown>),
        runtime.model.options as Record<string, unknown>,
      ),
      {
        ...runtime.model.headers,
        ...transport.headers,
        ...authHeaders,
        ...staticHeaders,
      },
    ),
  }

  if (apiKey && !(isGooglePackage(runtime.model.api.npm) && transport.authType === "bearer")) {
    options.apiKey = apiKey
  }

  const sdkCacheKey = stableStringify({
    providerID: runtime.providerID,
    npm: runtime.model.api.npm,
    options,
  })

  let sdk = providerSDKCache.get(sdkCacheKey)
  if (!sdk) {
    sdk = factory(options)
    providerSDKCache.set(sdkCacheKey, sdk)
  }

  const modelCacheKey = `${sdkCacheKey}:${runtime.model.api.id}`
  const existingModel = languageModelCache.get(modelCacheKey)
  if (existingModel) return existingModel

  const languageModel = (() => {
    if (runtime.model.api.npm === "@ai-sdk/openai" || runtime.model.api.npm === "@ai-sdk/azure") {
      const responses = sdk.responses
      if (typeof responses === "function") {
        return responses(runtime.model.api.id)
      }
    }

    if (runtime.model.api.npm === "@ai-sdk/github-copilot") {
      const responses = sdk.responses
      if (typeof responses === "function") {
        return responses(runtime.model.api.id)
      }
      const chat = sdk.chat
      if (typeof chat === "function") {
        return chat(runtime.model.api.id)
      }
    }

    return sdk.languageModel(runtime.model.api.id)
  })()

  languageModelCache.set(modelCacheKey, languageModel)
  return languageModel
}

async function prepareCallOptions(input: {
  runtime: ModelRuntimeContext
  origin: string
  sessionID: string
  requestID: string
  options: RuntimeLanguageModelCallOptions
}) {
  const plugins = getPluginManager()
  const context: ChatTransformContext = {
    providerID: input.runtime.providerID,
    modelID: input.runtime.modelID,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    auth: input.runtime.auth,
  }

  const authOptions = await plugins.loadAuthOptions({
    providerID: input.runtime.providerID,
    provider: input.runtime.provider,
    auth: input.runtime.auth,
  })

  const merged = mergeRecord(
    mergeRecord(input.options as Record<string, unknown>, {
      model: input.runtime.model.api.id,
      messages: toLegacyMessages(input.options.prompt),
    }),
    authOptions,
  )

  const chatPatched = await plugins.applyChatParams(context, merged)
  const requestPatched = await plugins.applyRequestOptions(context, chatPatched)
  const split = splitTransportOptions(requestPatched)

  const finalHeaders = await plugins.applyChatHeaders(context, {
    ...toHeaderRecord(input.options.headers),
    ...toHeaderRecord(split.body.headers),
  })

  const providerOptionKey = getProviderOptionKey(input.runtime.model)
  const knownKeys = new Set([
    "prompt",
    "maxOutputTokens",
    "max_tokens",
    "temperature",
    "stopSequences",
    "stop",
    "topP",
    "top_p",
    "topK",
    "presencePenalty",
    "frequencyPenalty",
    "responseFormat",
    "response_format",
    "seed",
    "tools",
    "toolChoice",
    "tool_choice",
    "includeRawChunks",
    "providerOptions",
    "headers",
    "model",
    "messages",
  ])

  const providerOptionsPatch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(split.body)) {
    if (knownKeys.has(key)) continue
    if (value === undefined) continue
    providerOptionsPatch[key] = value
  }

  const callOptions = toCallOptions(split.body, input.options)
  if (Object.keys(providerOptionsPatch).length > 0) {
    callOptions.providerOptions = mergeRecord(
      (callOptions.providerOptions as Record<string, unknown>) ?? {},
      {
        [providerOptionKey]: mergeRecord(
          ((callOptions.providerOptions as Record<string, unknown>)?.[providerOptionKey] as
            | Record<string, unknown>
            | undefined) ?? {},
          providerOptionsPatch,
        ),
      },
    ) as RuntimeLanguageModelCallOptions["providerOptions"]
  }

  callOptions.headers = finalHeaders

  return {
    context,
    prepared: {
      callOptions,
      transport: split.transport,
    } satisfies PreparedCallOptions,
  }
}

export async function getRuntimeModelDescriptor(input: {
  modelID: string
  origin: string
  sessionID: string
  requestID: string
}) {
  const runtime = await resolveModelRuntimeContext(input.modelID)
  const { prepared } = await prepareCallOptions({
    runtime,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    options: {
      prompt: [
        {
          role: "system",
          content: "describe capabilities",
        },
      ],
    },
  })

  const languageModel = await getLanguageModel(
    runtime,
    prepared.transport,
    toHeaderRecord(prepared.callOptions.headers),
  )
  const supportedUrls = await Promise.resolve(languageModel.supportedUrls ?? {})

  return {
    provider: languageModel.provider,
    modelId: languageModel.modelId,
    supportedUrls,
  }
}

export async function runLanguageModelGenerate(input: {
  modelID: string
  origin: string
  sessionID: string
  requestID: string
  options: RuntimeLanguageModelCallOptions
  signal?: AbortSignal
}): Promise<LanguageModelV3GenerateResult> {
  const runtime = await resolveModelRuntimeContext(input.modelID)
  const { prepared } = await prepareCallOptions({
    runtime,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    options: input.options,
  })

  const languageModel = await getLanguageModel(
    runtime,
    prepared.transport,
    toHeaderRecord(prepared.callOptions.headers),
  )
  return languageModel.doGenerate({
    ...prepared.callOptions,
    abortSignal: input.signal,
  })
}

export async function runLanguageModelStream(input: {
  modelID: string
  origin: string
  sessionID: string
  requestID: string
  options: RuntimeLanguageModelCallOptions
  signal?: AbortSignal
}): Promise<ReadableStream<LanguageModelV3StreamPart>> {
  const runtime = await resolveModelRuntimeContext(input.modelID)
  const { prepared } = await prepareCallOptions({
    runtime,
    origin: input.origin,
    sessionID: input.sessionID,
    requestID: input.requestID,
    options: input.options,
  })

  const languageModel = await getLanguageModel(
    runtime,
    prepared.transport,
    toHeaderRecord(prepared.callOptions.headers),
  )
  const result = await languageModel.doStream({
    ...prepared.callOptions,
    abortSignal: input.signal,
  })
  return result.stream
}
