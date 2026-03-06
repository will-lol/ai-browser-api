import {
  AuthFlowExpiredError,
  PermissionDeniedError,
  type RuntimeCancelProviderAuthFlowResponse,
  type RuntimeCreatePermissionRequestResponse,
  type RuntimeDismissPermissionRequestResponse,
  type RuntimeDisconnectProviderResponse,
  type RuntimeGenerateResponse,
  type RuntimeAuthFlowSnapshot,
  type RuntimeModelCallOptions,
  type RuntimeModelDescriptor,
  type RuntimeModelSummary,
  type RuntimeOpenProviderAuthWindowResponse,
  type RuntimeOriginState,
  type RuntimePendingRequest,
  type RuntimePermissionDecision,
  type RuntimePermissionEntry,
  type RuntimeProviderSummary,
  type RuntimeRequestPermissionInput,
  type RuntimeResolvePermissionRequestResponse,
  type RuntimeRpcError,
  type RuntimeSetOriginEnabledResponse,
  type RuntimeStartProviderAuthFlowResponse,
  type RuntimeStreamPart,
  type RuntimeUpdatePermissionResponse,
  RuntimeValidationError,
} from "@llm-bridge/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  AuthRepository,
  CatalogRepository,
  MetaRepository,
  ModelExecutionRepository,
  ModelsRepository,
  PendingRequestsRepository,
  PermissionsRepository,
  ProvidersRepository,
} from "./repositories"

type AppEffect<A> = Effect.Effect<A, RuntimeRpcError>

export interface CatalogServiceApi {
  ensureCatalog: () => AppEffect<void>
  refreshCatalog: () => AppEffect<void>
  refreshCatalogForProvider: (providerID: string) => AppEffect<void>
}

export class CatalogService extends Context.Tag("@llm-bridge/runtime-core/CatalogService")<
  CatalogService,
  CatalogServiceApi
>() {}

export const CatalogServiceLive = Layer.effect(
  CatalogService,
  Effect.gen(function*() {
    const catalog = yield* CatalogRepository
    return {
      ensureCatalog: () => catalog.ensureCatalog(),
      refreshCatalog: () => catalog.refreshCatalog(),
      refreshCatalogForProvider: (providerID: string) => catalog.refreshCatalogForProvider(providerID),
    } satisfies CatalogServiceApi
  }),
)

export interface RuntimeQueryServiceApi {
  listProviders: () => AppEffect<ReadonlyArray<RuntimeProviderSummary>>
  listModels: (input: {
    connectedOnly?: boolean
    providerID?: string
  }) => AppEffect<ReadonlyArray<RuntimeModelSummary>>
  getOriginState: (origin: string) => AppEffect<RuntimeOriginState>
  listPermissions: (origin: string) => AppEffect<ReadonlyArray<RuntimePermissionEntry>>
  listPending: (origin: string) => AppEffect<ReadonlyArray<RuntimePendingRequest>>
}

export class RuntimeQueryService extends Context.Tag("@llm-bridge/runtime-core/RuntimeQueryService")<
  RuntimeQueryService,
  RuntimeQueryServiceApi
>() {}

export const RuntimeQueryServiceLive = Layer.effect(
  RuntimeQueryService,
  Effect.gen(function*() {
    const providers = yield* ProvidersRepository
    const models = yield* ModelsRepository
    const permissions = yield* PermissionsRepository
    const pending = yield* PendingRequestsRepository

    return {
      listProviders: () => providers.listProviders(),
      listModels: (input) => models.listModels(input),
      getOriginState: (origin) => permissions.getOriginState(origin),
      listPermissions: (origin) => permissions.listPermissions(origin),
      listPending: (origin) => pending.listPending(origin),
    } satisfies RuntimeQueryServiceApi
  }),
)

export interface AuthFlowServiceApi {
  openProviderAuthWindow: (providerID: string) => AppEffect<RuntimeOpenProviderAuthWindowResponse>
  getProviderAuthFlow: (providerID: string) => AppEffect<{
    providerID: string
    result: RuntimeAuthFlowSnapshot
  }>
  startProviderAuthFlow: (input: {
    providerID: string
    methodID: string
    values?: Record<string, string>
  }) => AppEffect<RuntimeStartProviderAuthFlowResponse>
  cancelProviderAuthFlow: (input: {
    providerID: string
    reason?: string
  }) => AppEffect<RuntimeCancelProviderAuthFlowResponse>
  disconnectProvider: (providerID: string) => AppEffect<RuntimeDisconnectProviderResponse>
}

export class AuthFlowService extends Context.Tag("@llm-bridge/runtime-core/AuthFlowService")<
  AuthFlowService,
  AuthFlowServiceApi
>() {}

export const AuthFlowServiceLive = Layer.effect(
  AuthFlowService,
  Effect.gen(function*() {
    const auth = yield* AuthRepository
    const catalog = yield* CatalogService

    // Auth orchestration owns catalog refresh side-effects.
    return {
      openProviderAuthWindow: (providerID) => auth.openProviderAuthWindow(providerID),
      getProviderAuthFlow: (providerID) => auth.getProviderAuthFlow(providerID),
      startProviderAuthFlow: (input) =>
        auth.startProviderAuthFlow(input).pipe(
          Effect.tap(() => catalog.refreshCatalogForProvider(input.providerID)),
        ),
      cancelProviderAuthFlow: (input) => auth.cancelProviderAuthFlow(input),
      disconnectProvider: (providerID) =>
        auth.disconnectProvider(providerID).pipe(
          Effect.tap(() => catalog.refreshCatalogForProvider(providerID)),
        ),
    } satisfies AuthFlowServiceApi
  }),
).pipe(Layer.provide(CatalogServiceLive))

export interface PermissionServiceApi {
  ensureOriginEnabled: (origin: string) => AppEffect<void>
  ensureRequestAllowed: (origin: string, modelID: string, signal?: AbortSignal) => AppEffect<void>
  setOriginEnabled: (origin: string, enabled: boolean) => AppEffect<RuntimeSetOriginEnabledResponse>
  updatePermission: (input: {
    origin: string
    modelID: string
    status: RuntimePermissionDecision
    capabilities?: ReadonlyArray<string>
  }) => AppEffect<RuntimeUpdatePermissionResponse>
  requestPermission: (
    input: RuntimeRequestPermissionInput,
  ) => AppEffect<
    RuntimeCreatePermissionRequestResponse | RuntimeDismissPermissionRequestResponse | RuntimeResolvePermissionRequestResponse
  >
}

export class PermissionService extends Context.Tag("@llm-bridge/runtime-core/PermissionService")<
  PermissionService,
  PermissionServiceApi
>() {}

export const PermissionServiceLive = Layer.effect(
  PermissionService,
  Effect.gen(function*() {
    const permissions = yield* PermissionsRepository
    const meta = yield* MetaRepository

    const ensureOriginEnabled = (origin: string) =>
      Effect.gen(function*() {
        const state = yield* permissions.getOriginState(origin)
        if (state.enabled) return
        return yield* new RuntimeValidationError({
          message: `Origin ${origin} is disabled`,
        })
      })

    const ensureRequestAllowed = (origin: string, modelID: string, signal?: AbortSignal) =>
      Effect.gen(function*() {
        const permission = yield* permissions.getModelPermission(origin, modelID)
        if (permission === "allowed") return

        const parsed = meta.parseProviderModel(modelID)
        const result = yield* permissions.createPermissionRequest({
          origin,
          modelId: modelID,
          provider: parsed.providerID,
          modelName: parsed.modelID,
        })

        if (result.status === "alreadyAllowed") {
          return
        }

        const waitResult = yield* permissions.waitForPermissionDecision(result.request.id, undefined, signal)
        if (waitResult === "timeout") {
          return yield* new AuthFlowExpiredError({
            providerID: parsed.providerID,
            message: "Permission request timed out",
          })
        }
        if (waitResult === "aborted") {
          return yield* new RuntimeValidationError({
            message: "Request canceled",
          })
        }

        const updated = yield* permissions.getModelPermission(origin, modelID)
        if (updated !== "allowed") {
          return yield* new PermissionDeniedError({
            origin,
            modelId: modelID,
            message: "Permission denied",
          })
        }
      })

    const requestPermission = (input: RuntimeRequestPermissionInput) =>
      Effect.gen(function*() {
        switch (input.action) {
          case "resolve": {
            return yield* permissions.resolvePermissionRequest({
              requestId: input.requestId,
              decision: input.decision,
            })
          }
          case "dismiss": {
            return yield* permissions.dismissPermissionRequest(input.requestId)
          }
          case "create": {
            return yield* permissions.createPermissionRequest({
              origin: input.origin,
              modelId: input.modelId,
              modelName: input.modelName,
              provider: input.provider,
              capabilities: input.capabilities,
            })
          }
        }
      })

    return {
      ensureOriginEnabled,
      ensureRequestAllowed,
      setOriginEnabled: (origin, enabled) => permissions.setOriginEnabled(origin, enabled),
      updatePermission: (input) => permissions.updatePermission(input),
      requestPermission,
    } satisfies PermissionServiceApi
  }),
)

export interface ModelExecutionServiceApi {
  acquireModel: (input: {
    origin: string
    sessionID: string
    requestID: string
    modelID: string
  }) => AppEffect<RuntimeModelDescriptor>
  generateModel: (input: {
    origin: string
    requestID: string
    sessionID: string
    modelID: string
    options: RuntimeModelCallOptions
  }) => AppEffect<RuntimeGenerateResponse>
  streamModel: (input: {
    origin: string
    requestID: string
    sessionID: string
    modelID: string
    options: RuntimeModelCallOptions
  }) => AppEffect<ReadableStream<RuntimeStreamPart>>
  abortModelCall: (input: {
    origin: string
    sessionID: string
    requestID: string
  }) => AppEffect<void>
}

export class ModelExecutionService extends Context.Tag("@llm-bridge/runtime-core/ModelExecutionService")<
  ModelExecutionService,
  ModelExecutionServiceApi
>() {}

function withStreamCleanup<T>(
  stream: ReadableStream<T>,
  onFinalize: () => void,
): ReadableStream<T> {
  const reader = stream.getReader()

  return new ReadableStream<T>({
    async pull(controller) {
      const chunk = await reader.read()
      if (chunk.done) {
        onFinalize()
        controller.close()
        return
      }
      controller.enqueue(chunk.value)
    },
    async cancel() {
      try {
        await reader.cancel()
      } finally {
        onFinalize()
      }
    },
  })
}

export const ModelExecutionServiceLive = Layer.effect(
  ModelExecutionService,
  Effect.gen(function*() {
    const models = yield* ModelExecutionRepository
    const permissions = yield* PermissionService
    const controllers = new Map<string, AbortController>()
    const pendingAbortKeys = new Set<string>()

    const toControllerKey = (input: { origin: string; sessionID: string; requestID: string }) =>
      `${input.origin}::${input.sessionID}::${input.requestID}`

    const registerController = (input: { origin: string; sessionID: string; requestID: string }) =>
      Effect.sync(() => {
        const key = toControllerKey(input)
        const controller = new AbortController()
        controllers.set(key, controller)
        if (pendingAbortKeys.delete(key)) {
          controller.abort()
        }
        return controller
      })

    const unregisterController = (input: { origin: string; sessionID: string; requestID: string }) =>
      Effect.sync(() => {
        const key = toControllerKey(input)
        controllers.delete(key)
        pendingAbortKeys.delete(key)
      })

    // Model orchestration owns origin/permission policy checks.
    return {
      acquireModel: (input) =>
        Effect.gen(function*() {
          yield* permissions.ensureOriginEnabled(input.origin)
          yield* permissions.ensureRequestAllowed(input.origin, input.modelID)
          return yield* models.acquireModel(input)
        }),
      generateModel: (input) =>
        Effect.gen(function*() {
          const controllerInput = {
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
          }

          return yield* Effect.gen(function*() {
            const controller = yield* registerController(controllerInput)
            yield* permissions.ensureOriginEnabled(input.origin)
            yield* permissions.ensureRequestAllowed(input.origin, input.modelID, controller.signal)
            if (controller.signal.aborted) {
              return yield* new RuntimeValidationError({
                message: "Request canceled",
              })
            }
            return yield* models.generateModel({
              ...input,
              signal: controller.signal,
            })
          }).pipe(
            Effect.ensuring(unregisterController({
              origin: input.origin,
              sessionID: input.sessionID,
              requestID: input.requestID,
            })),
          )
        }),
      streamModel: (input) =>
        Effect.gen(function*() {
          const controllerInput = {
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
          }

          const controller = yield* registerController(controllerInput)
          const stream = yield* Effect.gen(function*() {
            yield* permissions.ensureOriginEnabled(input.origin)
            yield* permissions.ensureRequestAllowed(input.origin, input.modelID, controller.signal)
            if (controller.signal.aborted) {
              return yield* new RuntimeValidationError({
                message: "Request canceled",
              })
            }
            return yield* models.streamModel({
              ...input,
              signal: controller.signal,
            })
          }).pipe(
            Effect.tapError(() =>
              unregisterController({
                origin: input.origin,
                sessionID: input.sessionID,
                requestID: input.requestID,
              })),
          )

          return withStreamCleanup(stream, () => {
            controller.abort()
            controllers.delete(toControllerKey(controllerInput))
            pendingAbortKeys.delete(toControllerKey(controllerInput))
          })
        }),
      abortModelCall: (input) =>
        Effect.sync(() => {
          const key = toControllerKey({
            origin: input.origin,
            sessionID: input.sessionID,
            requestID: input.requestID,
          })
          const controller = controllers.get(key)
          if (!controller) {
            pendingAbortKeys.add(key)
            return
          }
          controller.abort()
          controllers.delete(key)
        }),
    } satisfies ModelExecutionServiceApi
  }),
)
