import {
  decodeRuntimeWireValue,
  encodeRuntimeWireValue,
  encodeSupportedUrls,
  RuntimeValidationError,
  toRuntimeRpcError,
  type JsonValue,
  type RuntimeGenerateResponse,
  type RuntimeModelCallOptions,
  type RuntimePromptMessage,
  type RuntimeRpcError,
  type RuntimeStreamPart,
  type RuntimeTool,
  type RuntimeUsage,
  type RuntimeWireDate,
  type RuntimeWireUint8Array,
  type RuntimeWireUrl,
} from "@llm-bridge/contracts"
import {
  AuthRepository,
  CatalogRepository,
  MetaRepository,
  ModelExecutionRepository,
  ModelsRepository,
  PendingRequestsRepository,
  PermissionsRepository,
  ProvidersRepository,
} from "@llm-bridge/runtime-core"
import type {
  JSONValue,
  JSONObject,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  SharedV3ProviderMetadata,
  SharedV3ProviderOptions,
} from "@ai-sdk/provider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { RuntimeLanguageModelCallOptions } from "@/lib/runtime/ai/language-model-runtime"
import { parseProviderModel } from "@/lib/runtime/util"
import {
  getOriginState,
  listModels,
  listPendingRequestsForOrigin,
  listPermissionsForOrigin,
  listProviders,
} from "@/lib/runtime/query-service"
import {
  cancelRuntimeProviderAuthFlow,
  createRuntimePermissionRequest,
  dismissRuntimePermissionRequest,
  disconnectRuntimeProvider,
  getRuntimeProviderAuthFlow,
  openRuntimeProviderAuthWindow,
  resolveRuntimePermissionRequest,
  setRuntimeOriginEnabled,
  startRuntimeProviderAuthFlow,
  updateRuntimePermission,
} from "@/lib/runtime/mutation-service"
import {
  acquireRuntimeModel,
  generateRuntimeModel,
  streamRuntimeModel,
} from "@/lib/runtime/service"
import {
  ensureProviderCatalog,
  refreshProviderCatalog,
  refreshProviderCatalogForProvider,
} from "@/lib/runtime/provider-registry"
import {
  getModelPermission,
  waitForPermissionDecision,
} from "@/lib/runtime/permissions"

type ProviderPromptMessage = RuntimeLanguageModelCallOptions["prompt"][number]
type ProviderToolSpec = NonNullable<RuntimeLanguageModelCallOptions["tools"]>[number]

type RuntimeUserMessage = Extract<RuntimePromptMessage, { role: "user" }>
type RuntimeAssistantMessage = Extract<RuntimePromptMessage, { role: "assistant" }>
type RuntimeToolMessage = Extract<RuntimePromptMessage, { role: "tool" }>
type RuntimeToolResultOutput = Extract<RuntimeAssistantMessage["content"][number], { type: "tool-result" }>["output"]

type ProviderUserPart = Extract<ProviderPromptMessage, { role: "user" }>["content"][number]
type ProviderAssistantPart = Extract<ProviderPromptMessage, { role: "assistant" }>["content"][number]
type ProviderToolPart = Extract<ProviderPromptMessage, { role: "tool" }>["content"][number]
type ProviderToolResultOutput = Extract<ProviderAssistantPart, { type: "tool-result" }>["output"]

function toEffect<T>(run: () => Promise<T>): Effect.Effect<T, RuntimeRpcError> {
  return Effect.tryPromise({
    try: run,
    catch: toRuntimeRpcError,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isWireUint8Array(value: unknown): value is RuntimeWireUint8Array {
  return (
    isRecord(value)
    && value.__llmBridgeWireType === "uint8array"
    && typeof value.base64 === "string"
  )
}

function isWireDate(value: unknown): value is RuntimeWireDate {
  return isRecord(value) && value.__llmBridgeWireType === "date" && typeof value.iso === "string"
}

function encodeWireDate(value: Date | undefined): RuntimeWireDate | undefined {
  if (!value) return undefined

  const encoded = encodeRuntimeWireValue(value)
  if (isWireDate(encoded)) {
    return encoded
  }

  throw new RuntimeValidationError({
    message: "Failed to encode Date value for runtime wire transport",
  })
}

function encodeBinaryData(value: Uint8Array): RuntimeWireUint8Array {
  const encoded = encodeRuntimeWireValue(value)
  if (isWireUint8Array(encoded)) {
    return encoded
  }

  throw new RuntimeValidationError({
    message: "Failed to encode binary value for runtime wire transport",
  })
}

function decodeDataContent(
  value: string | RuntimeWireUrl | RuntimeWireUint8Array,
): string | URL | Uint8Array {
  if (typeof value === "string") {
    return value
  }

  const decoded = decodeRuntimeWireValue(value)
  if (typeof decoded === "string" || decoded instanceof URL || decoded instanceof Uint8Array) {
    return decoded
  }

  throw new RuntimeValidationError({
    message: "Failed to decode prompt file data from runtime wire transport",
  })
}

function toProviderJsonValue(value: JsonValue): JSONValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toProviderJsonValue(entry))
  }

  const output: Record<string, JSONValue | undefined> = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = toProviderJsonValue(entry)
  }
  return output
}

function toProviderJsonObject(value: { readonly [key: string]: JsonValue }): JSONObject {
  return toProviderJsonValue(value) as JSONObject
}

function toContractJsonValue(value: JSONValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toContractJsonValue(entry))
  }

  const output: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue
    output[key] = toContractJsonValue(entry)
  }
  return output
}

function toContractJsonObject(value: JSONObject): { readonly [key: string]: JsonValue } {
  return toContractJsonValue(value) as { readonly [key: string]: JsonValue }
}

function toProviderOptions(
  value: RuntimeModelCallOptions["providerOptions"] | undefined,
): SharedV3ProviderOptions | undefined {
  if (!value) return undefined

  return Object.fromEntries(
    Object.entries(value).map(([provider, options]) => [
      provider,
      toProviderJsonObject(options),
    ]),
  )
}

function toProviderToolId(id: string): `${string}.${string}` {
  if (id.includes(".")) {
    return id as `${string}.${string}`
  }
  return `bridge.${id}`
}

function toContractProviderMetadata(
  value: SharedV3ProviderMetadata | undefined,
): RuntimeGenerateResponse["providerMetadata"] {
  if (!value) return undefined

  return Object.fromEntries(
    Object.entries(value).map(([provider, metadata]) => [
      provider,
      toContractJsonObject(metadata),
    ]),
  )
}

function decodeToolResultOutput(output: RuntimeToolResultOutput): ProviderToolResultOutput {
  switch (output.type) {
    case "text":
      return {
        type: "text",
        value: output.value,
        providerOptions: toProviderOptions(output.providerOptions),
      }
    case "json":
      return {
        type: "json",
        value: toProviderJsonValue(output.value),
        providerOptions: toProviderOptions(output.providerOptions),
      }
    case "execution-denied":
      return {
        type: "execution-denied",
        reason: output.reason,
        providerOptions: toProviderOptions(output.providerOptions),
      }
    case "error-text":
      return {
        type: "error-text",
        value: output.value,
        providerOptions: toProviderOptions(output.providerOptions),
      }
    case "error-json":
      return {
        type: "error-json",
        value: toProviderJsonValue(output.value),
        providerOptions: toProviderOptions(output.providerOptions),
      }
    case "content":
      return {
        type: "content",
        value: output.value.map((part) => ({
          ...part,
          providerOptions: toProviderOptions(part.providerOptions),
        })),
      }
  }
}

function decodeTool(tool: RuntimeTool): ProviderToolSpec {
  if (tool.type === "provider") {
    const args = Object.fromEntries(
      Object.entries(tool.args).map(([key, value]) => [
        key,
        decodeRuntimeWireValue(value),
      ]),
    )

    return {
      type: "provider",
      id: toProviderToolId(tool.id),
      name: tool.name,
      args,
    }
  }

  const decodedInputSchema = decodeRuntimeWireValue(tool.inputSchema)

  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    inputSchema: isRecord(decodedInputSchema) ? decodedInputSchema : {},
    inputExamples: tool.inputExamples?.map((example) => ({
      input: toProviderJsonObject(example.input),
    })),
    strict: tool.strict,
    providerOptions: toProviderOptions(tool.providerOptions),
  }
}

function decodeUserPart(part: RuntimeUserMessage["content"][number]): ProviderUserPart {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
      providerOptions: toProviderOptions(part.providerOptions),
    }
  }

  return {
    type: "file",
    filename: part.filename,
    data: decodeDataContent(part.data),
    mediaType: part.mediaType,
    providerOptions: toProviderOptions(part.providerOptions),
  }
}

function decodeAssistantPart(part: RuntimeAssistantMessage["content"][number]): ProviderAssistantPart {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        providerOptions: toProviderOptions(part.providerOptions),
      }
    case "file":
      return {
        type: "file",
        filename: part.filename,
        data: decodeDataContent(part.data),
        mediaType: part.mediaType,
        providerOptions: toProviderOptions(part.providerOptions),
      }
    case "reasoning":
      return {
        type: "reasoning",
        text: part.text,
        providerOptions: toProviderOptions(part.providerOptions),
      }
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: decodeRuntimeWireValue(part.input),
        providerExecuted: part.providerExecuted,
        providerOptions: toProviderOptions(part.providerOptions),
      }
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: decodeToolResultOutput(part.output),
        providerOptions: toProviderOptions(part.providerOptions),
      }
  }
}

function decodeToolPart(part: RuntimeToolMessage["content"][number]): ProviderToolPart {
  if (part.type === "tool-result") {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: decodeToolResultOutput(part.output),
      providerOptions: toProviderOptions(part.providerOptions),
    }
  }

  return {
    type: "tool-approval-response",
    approvalId: part.approvalId,
    approved: part.approved,
    reason: part.reason,
    providerOptions: toProviderOptions(part.providerOptions),
  }
}

function decodePromptMessage(message: RuntimePromptMessage): ProviderPromptMessage {
  switch (message.role) {
    case "system":
      return {
        role: "system",
        content: message.content,
        providerOptions: toProviderOptions(message.providerOptions),
      }
    case "user":
      return {
        role: "user",
        content: message.content.map((part) => decodeUserPart(part)),
        providerOptions: toProviderOptions(message.providerOptions),
      }
    case "assistant":
      return {
        role: "assistant",
        content: message.content.map((part) => decodeAssistantPart(part)),
        providerOptions: toProviderOptions(message.providerOptions),
      }
    case "tool":
      return {
        role: "tool",
        content: message.content.map((part) => decodeToolPart(part)),
        providerOptions: toProviderOptions(message.providerOptions),
      }
  }
}

function decodeResponseFormat(
  responseFormat: RuntimeModelCallOptions["responseFormat"],
): RuntimeLanguageModelCallOptions["responseFormat"] {
  if (!responseFormat) {
    return undefined
  }

  if (responseFormat.type === "text") {
    return {
      type: "text",
    }
  }

  const decodedSchema = responseFormat.schema === undefined
    ? undefined
    : decodeRuntimeWireValue(responseFormat.schema)

  return {
    type: "json",
    schema: isRecord(decodedSchema) ? decodedSchema : undefined,
    name: responseFormat.name,
    description: responseFormat.description,
  }
}

function decodeCallOptions(options: RuntimeModelCallOptions): RuntimeLanguageModelCallOptions {
  return {
    prompt: options.prompt.map((message) => decodePromptMessage(message)),
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    stopSequences: options.stopSequences ? [...options.stopSequences] : undefined,
    topP: options.topP,
    topK: options.topK,
    presencePenalty: options.presencePenalty,
    frequencyPenalty: options.frequencyPenalty,
    responseFormat: decodeResponseFormat(options.responseFormat),
    seed: options.seed,
    tools: options.tools?.map((tool) => decodeTool(tool)),
    toolChoice: options.toolChoice,
    includeRawChunks: options.includeRawChunks,
    headers: options.headers ? { ...options.headers } : undefined,
    providerOptions: toProviderOptions(options.providerOptions),
  }
}

function encodeUsage(usage: LanguageModelV3GenerateResult["usage"]): RuntimeUsage {
  return {
    inputTokens: {
      total: usage.inputTokens.total,
      noCache: usage.inputTokens.noCache,
      cacheRead: usage.inputTokens.cacheRead,
      cacheWrite: usage.inputTokens.cacheWrite,
    },
    outputTokens: {
      total: usage.outputTokens.total,
      text: usage.outputTokens.text,
      reasoning: usage.outputTokens.reasoning,
    },
    raw: usage.raw ? toContractJsonObject(usage.raw) : undefined,
  }
}

function encodeContentPart(
  part: LanguageModelV3GenerateResult["content"][number],
): RuntimeGenerateResponse["content"][number] {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "reasoning":
      return {
        type: "reasoning",
        text: part.text,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "file":
      return {
        type: "file",
        mediaType: part.mediaType,
        data: typeof part.data === "string" ? part.data : encodeBinaryData(part.data),
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "tool-approval-request":
      return {
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "source":
      return part.sourceType === "url"
        ? {
            type: "source",
            sourceType: "url",
            id: part.id,
            url: part.url,
            title: part.title,
            providerMetadata: toContractProviderMetadata(part.providerMetadata),
          }
        : {
            type: "source",
            sourceType: "document",
            id: part.id,
            mediaType: part.mediaType,
            title: part.title,
            filename: part.filename,
            providerMetadata: toContractProviderMetadata(part.providerMetadata),
          }
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: toContractJsonValue(part.result),
        isError: part.isError,
        preliminary: part.preliminary,
        dynamic: part.dynamic,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
  }
}

function toGenerateResponse(result: LanguageModelV3GenerateResult): RuntimeGenerateResponse {
  return {
    content: result.content.map((part) => encodeContentPart(part)),
    finishReason: result.finishReason,
    usage: encodeUsage(result.usage),
    providerMetadata: toContractProviderMetadata(result.providerMetadata),
    request: result.request
      ? {
          body: result.request.body === undefined
            ? undefined
            : encodeRuntimeWireValue(result.request.body),
        }
      : undefined,
    response: result.response
      ? {
          id: result.response.id,
          timestamp: encodeWireDate(result.response.timestamp),
          modelId: result.response.modelId,
          headers: result.response.headers ? { ...result.response.headers } : undefined,
          body: result.response.body === undefined
            ? undefined
            : encodeRuntimeWireValue(result.response.body),
        }
      : undefined,
    warnings: result.warnings.map((warning) => ({ ...warning })),
  }
}

function mapStreamPart(part: LanguageModelV3StreamPart): RuntimeStreamPart {
  switch (part.type) {
    case "text-start":
      return {
        type: "text-start",
        id: part.id,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "text-delta":
      return {
        type: "text-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "text-end":
      return {
        type: "text-end",
        id: part.id,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "reasoning-start":
      return {
        type: "reasoning-start",
        id: part.id,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "reasoning-delta":
      return {
        type: "reasoning-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "reasoning-end":
      return {
        type: "reasoning-end",
        id: part.id,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "tool-input-start":
      return {
        type: "tool-input-start",
        id: part.id,
        toolName: part.toolName,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        title: part.title,
      }
    case "tool-input-delta":
      return {
        type: "tool-input-delta",
        id: part.id,
        delta: part.delta,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "tool-input-end":
      return {
        type: "tool-input-end",
        id: part.id,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "tool-approval-request":
      return {
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCallId,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerExecuted: part.providerExecuted,
        dynamic: part.dynamic,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: toContractJsonValue(part.result),
        isError: part.isError,
        preliminary: part.preliminary,
        dynamic: part.dynamic,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "file":
      return {
        type: "file",
        mediaType: part.mediaType,
        data: typeof part.data === "string" ? part.data : encodeBinaryData(part.data),
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "source":
      return part.sourceType === "url"
        ? {
            type: "source",
            sourceType: "url",
            id: part.id,
            url: part.url,
            title: part.title,
            providerMetadata: toContractProviderMetadata(part.providerMetadata),
          }
        : {
            type: "source",
            sourceType: "document",
            id: part.id,
            mediaType: part.mediaType,
            title: part.title,
            filename: part.filename,
            providerMetadata: toContractProviderMetadata(part.providerMetadata),
          }
    case "stream-start":
      return {
        type: "stream-start",
        warnings: part.warnings.map((warning) => ({ ...warning })),
      }
    case "response-metadata":
      return {
        type: "response-metadata",
        id: part.id,
        timestamp: encodeWireDate(part.timestamp),
        modelId: part.modelId,
      }
    case "finish":
      return {
        type: "finish",
        usage: encodeUsage(part.usage),
        finishReason: part.finishReason,
        providerMetadata: toContractProviderMetadata(part.providerMetadata),
      }
    case "raw":
      return {
        type: "raw",
        rawValue: encodeRuntimeWireValue(part.rawValue),
      }
    case "error":
      return {
        type: "error",
        error: encodeRuntimeWireValue(part.error),
      }
  }
}

function mapStream(stream: ReadableStream<LanguageModelV3StreamPart>): ReadableStream<RuntimeStreamPart> {
  const reader = stream.getReader()

  return new ReadableStream<RuntimeStreamPart>({
    async pull(controller) {
      const chunk = await reader.read()
      if (chunk.done) {
        controller.close()
        return
      }

      controller.enqueue(mapStreamPart(chunk.value))
    },
    async cancel() {
      await reader.cancel()
    },
  })
}

export function makeRuntimeCoreInfrastructureLayer() {
  const ProvidersRepoLive = Layer.succeed(ProvidersRepository, {
    listProviders: () => toEffect(() => listProviders()),
  })

  const ModelsRepoLive = Layer.succeed(ModelsRepository, {
    listModels: (input: { connectedOnly?: boolean; providerID?: string }) => toEffect(() => listModels(input)),
  })

  const AuthRepoLive = Layer.succeed(AuthRepository, {
    openProviderAuthWindow: (providerID: string) => toEffect(() => openRuntimeProviderAuthWindow(providerID)),
    getProviderAuthFlow: (providerID: string) => toEffect(() => getRuntimeProviderAuthFlow(providerID)),
    startProviderAuthFlow: (input: {
      providerID: string
      methodID: string
      values?: Record<string, string>
    }) =>
      toEffect(() => startRuntimeProviderAuthFlow(input)),
    cancelProviderAuthFlow: (input: { providerID: string; reason?: string }) =>
      toEffect(() => cancelRuntimeProviderAuthFlow(input)),
    disconnectProvider: (providerID: string) => toEffect(() => disconnectRuntimeProvider(providerID)),
  })

  const PermissionsRepoLive = Layer.succeed(PermissionsRepository, {
    getOriginState: (origin: string) => toEffect(() => getOriginState(origin)),
    listPermissions: (origin: string) => toEffect(() => listPermissionsForOrigin(origin)),
    getModelPermission: (origin: string, modelID: string) => toEffect(() => getModelPermission(origin, modelID)),
    setOriginEnabled: (origin: string, enabled: boolean) =>
      toEffect(() => setRuntimeOriginEnabled({ origin, enabled })),
    updatePermission: (input: {
      origin: string
      modelID: string
      status: "allowed" | "denied"
      capabilities?: ReadonlyArray<string>
    }) =>
      toEffect(() =>
        updateRuntimePermission({
          origin: input.origin,
          modelId: input.modelID,
          status: input.status,
          capabilities: input.capabilities ? [...input.capabilities] : undefined,
        })),
    createPermissionRequest: (input: {
      origin: string
      modelId: string
      provider: string
      modelName: string
      capabilities?: ReadonlyArray<string>
    }) =>
      toEffect(() =>
        createRuntimePermissionRequest({
          ...input,
          capabilities: input.capabilities ? [...input.capabilities] : undefined,
        })),
    resolvePermissionRequest: (input: { requestId: string; decision: "allowed" | "denied" }) =>
      toEffect(() => resolveRuntimePermissionRequest(input)),
    dismissPermissionRequest: (requestId: string) => toEffect(() => dismissRuntimePermissionRequest(requestId)),
    waitForPermissionDecision: (requestId: string, timeoutMs?: number, signal?: AbortSignal) =>
      toEffect(() => waitForPermissionDecision(requestId, timeoutMs, signal)),
  })

  const PendingRequestsRepoLive = Layer.succeed(PendingRequestsRepository, {
    listPending: (origin: string) => toEffect(() => listPendingRequestsForOrigin(origin)),
  })

  const MetaRepoLive = Layer.succeed(MetaRepository, {
    parseProviderModel: (modelID: string) => parseProviderModel(modelID),
  })

  const ModelExecutionRepoLive = Layer.succeed(ModelExecutionRepository, {
    acquireModel: (input: {
      origin: string
      sessionID: string
      requestID: string
      modelID: string
    }) =>
      toEffect(() =>
        acquireRuntimeModel({
          origin: input.origin,
          sessionID: input.sessionID,
          requestID: input.requestID,
          model: input.modelID,
        }).then((descriptor) => ({
          specificationVersion: "v3",
          provider: descriptor.provider,
          modelId: descriptor.modelId,
          supportedUrls: encodeSupportedUrls(descriptor.supportedUrls),
        }))),
    generateModel: (input: {
      origin: string
      sessionID: string
      requestID: string
      modelID: string
      options: RuntimeModelCallOptions
      signal?: AbortSignal
    }) =>
      toEffect(() =>
        generateRuntimeModel(
          {
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
            model: input.modelID,
            options: decodeCallOptions(input.options),
          },
          input.signal,
        ).then((result) => toGenerateResponse(result))),
    streamModel: (input: {
      origin: string
      sessionID: string
      requestID: string
      modelID: string
      options: RuntimeModelCallOptions
      signal?: AbortSignal
    }) =>
      toEffect(() =>
        streamRuntimeModel(
          {
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
            model: input.modelID,
            options: decodeCallOptions(input.options),
          },
          input.signal,
        ).then((stream) => mapStream(stream))),
  })

  const CatalogRepoLive = Layer.succeed(CatalogRepository, {
    ensureCatalog: () => toEffect(() => ensureProviderCatalog()),
    refreshCatalog: () => toEffect(() => refreshProviderCatalog()).pipe(Effect.asVoid),
    refreshCatalogForProvider: (providerID: string) =>
      toEffect(() => refreshProviderCatalogForProvider(providerID)),
  })

  return Layer.mergeAll(
    ProvidersRepoLive,
    ModelsRepoLive,
    AuthRepoLive,
    PermissionsRepoLive,
    PendingRequestsRepoLive,
    MetaRepoLive,
    ModelExecutionRepoLive,
    CatalogRepoLive,
  )
}
