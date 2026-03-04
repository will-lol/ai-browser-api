import {
  ensureJsonObject,
  RuntimeValidationError,
  type JsonValue,
  type RuntimeGenerateResponse,
  type RuntimeModelDescriptor,
  type RuntimeStreamPart,
  type RuntimeUsage,
} from "@llm-bridge/contracts"
import {
  ActionStateRepository,
  AuthRepository,
  CatalogRepository,
  MetaRepository,
  ModelExecutionRepository,
  ModelsRepository,
  PendingRequestsRepository,
  PermissionsRepository,
  ProvidersRepository,
} from "@llm-bridge/runtime-core"
import type { LanguageModelV3GenerateResult, LanguageModelV3StreamPart } from "@ai-sdk/provider"
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

function unknownToValidationError(error: unknown) {
  if (error instanceof RuntimeValidationError) return error

  const message = error instanceof Error ? error.message : String(error)
  return new RuntimeValidationError({
    message,
  })
}

function toEffect<T>(run: () => Promise<T>): Effect.Effect<T, RuntimeValidationError> {
  return Effect.tryPromise({
    try: run,
    catch: (error) => unknownToValidationError(error),
  })
}

function toUsage(usage: unknown): RuntimeUsage {
  const value = usage as {
    inputTokens?: { total?: number }
    outputTokens?: { total?: number }
  }

  const inputTokens = value?.inputTokens?.total ?? 0
  const outputTokens = value?.outputTokens?.total ?? 0

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  }
}

function toJsonObject(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      value: String(value),
    }
  }

  try {
    return ensureJsonObject(JSON.parse(JSON.stringify(value)))
  } catch {
    return {
      value: String(value),
    }
  }
}

function toGenerateResponse(input: {
  requestID: string
  modelID: string
  result: LanguageModelV3GenerateResult
}): RuntimeGenerateResponse {
  const text = input.result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")

  return {
    requestId: input.requestID,
    modelId: input.modelID,
    text,
    finishReason: String(input.result.finishReason),
    usage: toUsage(input.result.usage),
    providerMetadata: input.result.providerMetadata ? toJsonObject(input.result.providerMetadata) : undefined,
  }
}

function mapStreamPart(part: LanguageModelV3StreamPart): RuntimeStreamPart {
  if (part.type === "text-delta") {
    return {
      type: "text-delta",
      delta: part.delta,
    }
  }

  if (part.type === "finish") {
    return {
      type: "finish",
      finishReason: String(part.finishReason),
      usage: toUsage(part.usage),
    }
  }

  if (part.type === "error") {
    return {
      type: "error",
      message: part.error instanceof Error ? part.error.message : String(part.error),
    }
  }

  return {
    type: "other",
    value: toJsonObject(part),
  }
}

function mapSupportedUrls(
  input: Record<string, RegExp[]> | undefined,
): RuntimeModelDescriptor["supportedUrls"] {
  const output: Record<string, Array<{ source: string; flags?: string }>> = {}

  if (!input) return output

  for (const [mediaType, patterns] of Object.entries(input)) {
    output[mediaType] = patterns.map((pattern) => ({
      source: pattern.source,
      flags: pattern.flags,
    }))
  }

  return output
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

export function makeRuntimeCoreInfrastructureLayer(options: {
  refreshActionState: () => Promise<void>
}) {
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
    waitForPermissionDecision: (requestId: string, timeoutMs?: number) =>
      toEffect(() => waitForPermissionDecision(requestId, timeoutMs)),
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
          supportedUrls: mapSupportedUrls(descriptor.supportedUrls),
        }))),
    generateModel: (input: {
      origin: string
      sessionID: string
      requestID: string
      modelID: string
      options: Record<string, JsonValue>
      signal?: AbortSignal
    }) =>
      toEffect(() =>
        generateRuntimeModel(
          {
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
            model: input.modelID,
            options: input.options as RuntimeLanguageModelCallOptions,
          },
          input.signal,
        ).then((result) =>
          toGenerateResponse({
            requestID: input.requestID,
            modelID: input.modelID,
            result,
          }))),
    streamModel: (input: {
      origin: string
      sessionID: string
      requestID: string
      modelID: string
      options: Record<string, JsonValue>
      signal?: AbortSignal
    }) =>
      toEffect(() =>
        streamRuntimeModel(
          {
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
            model: input.modelID,
            options: input.options as RuntimeLanguageModelCallOptions,
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

  const ActionStateRepoLive = Layer.succeed(ActionStateRepository, {
    refreshActionState: () => toEffect(() => options.refreshActionState()),
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
    ActionStateRepoLive,
  )
}
