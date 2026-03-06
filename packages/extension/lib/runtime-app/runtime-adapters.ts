import {
  fromRuntimeModelCallOptions,
  toRuntimeGenerateResponse,
  toRuntimeStreamPart,
} from "@llm-bridge/bridge-codecs"
import {
  ModelNotFoundError,
  ProviderNotConnectedError,
  encodeSupportedUrls,
  toRuntimeRpcError,
  type RuntimeModelCallOptions,
  type RuntimeRpcError,
  type RuntimeStreamPart,
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
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  getRuntimeModelDescriptor,
  runLanguageModelGenerate,
  runLanguageModelStream,
} from "@/lib/runtime/ai/language-model-runtime"
import { getAuthFlowManager } from "@/lib/runtime/auth-flow-manager"
import { resolveTrustedPermissionTarget } from "@/lib/runtime/permission-targets"
import { parseProviderModel } from "@/lib/runtime/util"
import {
  getOriginState,
  listModels,
  listPendingRequestsForOrigin,
  listPermissionsForOrigin,
  listProviders,
} from "@/lib/runtime/query-service"
import { disconnectProvider } from "@/lib/runtime/provider-auth"
import {
  ensureProviderCatalog,
  refreshProviderCatalog,
  refreshProviderCatalogForProvider,
} from "@/lib/runtime/provider-registry"
import {
  createPermissionRequest,
  dismissPermissionRequest,
  getModelPermission,
  resolvePermissionRequest,
  setModelPermission,
  setOriginEnabled,
  waitForPermissionDecision,
} from "@/lib/runtime/permissions"

function toEffect<T>(run: () => Promise<T>): Effect.Effect<T, RuntimeRpcError> {
  return Effect.tryPromise({
    try: run,
    catch: toRuntimeRpcError,
  })
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

      controller.enqueue(toRuntimeStreamPart(chunk.value))
    },
    async cancel() {
      await reader.cancel()
    },
  })
}

// This layer only bridges runtime-core repository interfaces to extension primitives.
// Policy ownership (catalog refresh + permission checks) stays in runtime-core services.
export function makeRuntimeCoreInfrastructureLayer() {
  const ProvidersRepoLive = Layer.succeed(ProvidersRepository, {
    listProviders: () => toEffect(() => listProviders()),
  })

  const ModelsRepoLive = Layer.succeed(ModelsRepository, {
    listModels: (input: { connectedOnly?: boolean; providerID?: string }) => toEffect(() => listModels(input)),
  })

  const AuthRepoLive = Layer.succeed(AuthRepository, {
    openProviderAuthWindow: (providerID: string) =>
      toEffect(() => {
        const manager = getAuthFlowManager()
        return manager.openProviderAuthWindow(providerID)
      }),
    getProviderAuthFlow: (providerID: string) =>
      toEffect(async () => {
        const manager = getAuthFlowManager()
        return {
          providerID,
          result: await manager.getProviderAuthFlow(providerID),
        }
      }),
    startProviderAuthFlow: (input: {
      providerID: string
      methodID: string
      values?: Record<string, string>
    }) =>
      toEffect(async () => {
        const manager = getAuthFlowManager()
        return {
          providerID: input.providerID,
          result: await manager.startProviderAuthFlow(input),
        }
      }),
    cancelProviderAuthFlow: (input: { providerID: string; reason?: string }) =>
      toEffect(async () => {
        const manager = getAuthFlowManager()
        return {
          providerID: input.providerID,
          result: await manager.cancelProviderAuthFlow(input),
        }
      }),
    disconnectProvider: (providerID: string) =>
      toEffect(async () => {
        const manager = getAuthFlowManager()
        await manager.cancelProviderAuthFlow({
          providerID,
          reason: "disconnect",
        }).catch(() => {
          // Ignore cancellation failures and continue disconnecting stored auth.
        })

        await disconnectProvider(providerID)
        return {
          providerID,
          connected: false,
        }
      }),
  })

  const PermissionsRepoLive = Layer.succeed(PermissionsRepository, {
    getOriginState: (origin: string) => toEffect(() => getOriginState(origin)),
    listPermissions: (origin: string) => toEffect(() => listPermissionsForOrigin(origin)),
    getModelPermission: (origin: string, modelID: string) => toEffect(() => getModelPermission(origin, modelID)),
    setOriginEnabled: (origin: string, enabled: boolean) =>
      toEffect(async () => {
        await setOriginEnabled(origin, enabled)
        return {
          origin,
          enabled,
        }
      }),
    updatePermission: (input: {
      origin: string
      modelID: string
      status: "allowed" | "denied"
      capabilities?: ReadonlyArray<string>
    }) =>
      toEffect(async () => {
        await setModelPermission(
          input.origin,
          input.modelID,
          input.status,
          input.capabilities ? [...input.capabilities] : undefined,
        )
        return {
          origin: input.origin,
          modelId: input.modelID,
          status: input.status,
        }
      }),
    createPermissionRequest: (input: {
      origin: string
      modelId: string
      provider: string
      modelName: string
      capabilities?: ReadonlyArray<string>
    }) =>
      toEffect(() =>
        createPermissionRequest({
          ...input,
          capabilities: input.capabilities ? [...input.capabilities] : undefined,
        })),
    resolvePermissionRequest: (input: { requestId: string; decision: "allowed" | "denied" }) =>
      toEffect(async () => {
        await resolvePermissionRequest(input.requestId, input.decision)
        return {
          requestId: input.requestId,
          decision: input.decision,
        }
      }),
    dismissPermissionRequest: (requestId: string) =>
      toEffect(async () => {
        await dismissPermissionRequest(requestId)
        return {
          requestId,
        }
      }),
    waitForPermissionDecision: (requestId: string, timeoutMs?: number, signal?: AbortSignal) =>
      toEffect(() => waitForPermissionDecision(requestId, timeoutMs, signal)),
  })

  const PendingRequestsRepoLive = Layer.succeed(PendingRequestsRepository, {
    listPending: (origin: string) => toEffect(() => listPendingRequestsForOrigin(origin)),
  })

  const MetaRepoLive = Layer.succeed(MetaRepository, {
    parseProviderModel: (modelID: string) => parseProviderModel(modelID),
    resolvePermissionTarget: (modelID: string) =>
      toEffect(async () => {
        await ensureProviderCatalog()
        const resolution = await resolveTrustedPermissionTarget(modelID)
        if (resolution.status === "resolved") {
          return resolution.target
        }
        if (resolution.status === "disconnected") {
          throw new ProviderNotConnectedError({
            providerID: resolution.provider,
            message: `Provider ${resolution.provider} is not connected`,
          })
        }

        throw new ModelNotFoundError({
          modelId: modelID,
          message: `Model ${modelID} was not found`,
        })
      }),
  })

  const ModelExecutionRepoLive = Layer.succeed(ModelExecutionRepository, {
    acquireModel: (input: {
      origin: string
      sessionID: string
      requestID: string
      modelID: string
    }) =>
      toEffect(() =>
        getRuntimeModelDescriptor({
          modelID: input.modelID,
          origin: input.origin,
          sessionID: input.sessionID,
          requestID: input.requestID,
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
        runLanguageModelGenerate(
          {
            modelID: input.modelID,
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
            options: fromRuntimeModelCallOptions(input.options),
            signal: input.signal,
          },
        ).then((result) => toRuntimeGenerateResponse(result))),
    streamModel: (input: {
      origin: string
      sessionID: string
      requestID: string
      modelID: string
      options: RuntimeModelCallOptions
      signal?: AbortSignal
    }) =>
      toEffect(() =>
        runLanguageModelStream(
          {
            modelID: input.modelID,
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
            options: fromRuntimeModelCallOptions(input.options),
            signal: input.signal,
          },
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
