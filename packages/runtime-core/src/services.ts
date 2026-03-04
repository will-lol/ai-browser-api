import {
  AuthFlowExpiredError,
  PermissionDeniedError,
  type RuntimeCancelProviderAuthFlowResponse,
  type RuntimeCreatePermissionRequestResponse,
  type RuntimeDismissPermissionRequestResponse,
  type RuntimeDisconnectProviderResponse,
  type RuntimeGenerateResponse,
  type RuntimeModelCallInput,
  type RuntimeModelDescriptor,
  type RuntimeOpenProviderAuthWindowResponse,
  type RuntimeOriginState,
  type RuntimePendingRequest,
  type RuntimePermissionDecision,
  type RuntimePermissionEntry,
  type RuntimeProviderSummary,
  type RuntimeRequestPermissionInput,
  type RuntimeResolvePermissionRequestResponse,
  type RuntimeSetOriginEnabledResponse,
  type RuntimeStartProviderAuthFlowResponse,
  type RuntimeStreamPart,
  type RuntimeUpdatePermissionInput,
  type RuntimeUpdatePermissionResponse,
  RuntimeValidationError,
} from "@llm-bridge/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
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
} from "./repositories"

type AppEffect<A> = Effect.Effect<A, unknown>

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
  }) => AppEffect<ReadonlyArray<import("@llm-bridge/contracts").RuntimeModelSummary>>
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
    result: import("@llm-bridge/contracts").RuntimeAuthFlowSnapshot
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
    const action = yield* ActionStateRepository
    const catalog = yield* CatalogService

    return {
      openProviderAuthWindow: (providerID) => auth.openProviderAuthWindow(providerID),
      getProviderAuthFlow: (providerID) => auth.getProviderAuthFlow(providerID),
      startProviderAuthFlow: (input) =>
        auth.startProviderAuthFlow(input).pipe(
          Effect.tap(() => catalog.refreshCatalogForProvider(input.providerID)),
          Effect.tap(() => action.refreshActionState()),
        ),
      cancelProviderAuthFlow: (input) =>
        auth.cancelProviderAuthFlow(input).pipe(
          Effect.tap(() => action.refreshActionState()),
        ),
      disconnectProvider: (providerID) =>
        auth.disconnectProvider(providerID).pipe(
          Effect.tap(() => catalog.refreshCatalogForProvider(providerID)),
          Effect.tap(() => action.refreshActionState()),
        ),
    } satisfies AuthFlowServiceApi
  }),
).pipe(Layer.provide(CatalogServiceLive))

export interface PermissionServiceApi {
  ensureOriginEnabled: (origin: string) => AppEffect<void>
  ensureRequestAllowed: (origin: string, modelID: string) => AppEffect<void>
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
    const action = yield* ActionStateRepository
    const meta = yield* MetaRepository

    const ensureOriginEnabled: PermissionServiceApi["ensureOriginEnabled"] = (origin) =>
      Effect.gen(function*() {
        const state = yield* permissions.getOriginState(origin)
        if (state.enabled) return
        return yield* new RuntimeValidationError({
          message: `Origin ${origin} is disabled`,
        })
      })

    const ensureRequestAllowed: PermissionServiceApi["ensureRequestAllowed"] = (origin, modelID) =>
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

        const waitResult = yield* permissions.waitForPermissionDecision(result.request.id)
        if (waitResult === "timeout") {
          return yield* new AuthFlowExpiredError({
            providerID: parsed.providerID,
            message: "Permission request timed out",
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

    const requestPermission: PermissionServiceApi["requestPermission"] = (input) =>
      Effect.gen(function*() {
        switch (input.action) {
          case "resolve": {
            const result = yield* permissions.resolvePermissionRequest({
              requestId: input.requestId,
              decision: input.decision,
            })
            yield* action.refreshActionState()
            return result
          }
          case "dismiss": {
            const result = yield* permissions.dismissPermissionRequest(input.requestId)
            yield* action.refreshActionState()
            return result
          }
          case "create": {
            const result = yield* permissions.createPermissionRequest({
              origin: input.origin,
              modelId: input.modelId,
              modelName: input.modelName,
              provider: input.provider,
              capabilities: input.capabilities,
            })
            yield* action.refreshActionState()
            return result
          }
        }
      })

    return {
      ensureOriginEnabled,
      ensureRequestAllowed,
      setOriginEnabled: (origin, enabled) =>
        permissions.setOriginEnabled(origin, enabled).pipe(
          Effect.tap(() => action.refreshActionState()),
        ),
      updatePermission: (input) =>
        permissions.updatePermission(input).pipe(
          Effect.tap(() => action.refreshActionState()),
        ),
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
    options: RuntimeModelCallInput["options"]
  }) => AppEffect<RuntimeGenerateResponse>
  streamModel: (input: {
    origin: string
    requestID: string
    sessionID: string
    modelID: string
    options: RuntimeModelCallInput["options"]
  }) => AppEffect<ReadableStream<RuntimeStreamPart>>
  abortModelCall: (requestID: string) => AppEffect<void>
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
    const action = yield* ActionStateRepository
    const controllers = new Map<string, AbortController>()

    const registerController = (requestID: string) =>
      Effect.sync(() => {
        const controller = new AbortController()
        controllers.set(requestID, controller)
        return controller
      })

    const unregisterController = (requestID: string) =>
      Effect.sync(() => {
        controllers.delete(requestID)
      })

    return {
      acquireModel: (input) =>
        Effect.gen(function*() {
          yield* permissions.ensureOriginEnabled(input.origin)
          yield* permissions.ensureRequestAllowed(input.origin, input.modelID)
          return yield* models.acquireModel(input)
        }).pipe(Effect.tap(() => action.refreshActionState())),
      generateModel: (input) =>
        Effect.gen(function*() {
          yield* permissions.ensureOriginEnabled(input.origin)
          yield* permissions.ensureRequestAllowed(input.origin, input.modelID)
          const controller = yield* registerController(input.requestID)
          return yield* models.generateModel({
            ...input,
            signal: controller.signal,
          }).pipe(
            Effect.ensuring(unregisterController(input.requestID)),
            Effect.tap(() => action.refreshActionState()),
          )
        }),
      streamModel: (input) =>
        Effect.gen(function*() {
          yield* permissions.ensureOriginEnabled(input.origin)
          yield* permissions.ensureRequestAllowed(input.origin, input.modelID)
          const controller = yield* registerController(input.requestID)
          const stream = yield* models.streamModel({
            ...input,
            signal: controller.signal,
          })

          return withStreamCleanup(stream, () => {
            controller.abort()
            controllers.delete(input.requestID)
          })
        }).pipe(Effect.tap(() => action.refreshActionState())),
      abortModelCall: (requestID) =>
        Effect.sync(() => {
          controllers.get(requestID)?.abort()
          controllers.delete(requestID)
        }).pipe(Effect.tap(() => action.refreshActionState())),
    } satisfies ModelExecutionServiceApi
  }),
)
