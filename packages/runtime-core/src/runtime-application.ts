import type {
  RuntimeCreatePermissionRequestResponse,
  RuntimeDismissPermissionRequestResponse,
  RuntimeModelSummary,
  RuntimeRequestPermissionInput,
  RuntimeResolvePermissionRequestResponse,
  RuntimeUpdatePermissionInput,
} from "@llm-bridge/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  AuthFlowService,
  AuthFlowServiceLive,
  CatalogService,
  CatalogServiceLive,
  ModelExecutionService,
  ModelExecutionServiceLive,
  PermissionService,
  PermissionServiceLive,
  RuntimeQueryService,
  RuntimeQueryServiceLive,
} from "./services"

type AppEffect<A> = Effect.Effect<A, unknown>

export interface RuntimeApplicationApi {
  startup: () => AppEffect<void>
  listProviders: (origin: string) => AppEffect<ReadonlyArray<import("@llm-bridge/contracts").RuntimeProviderSummary>>
  listModels: (input: {
    origin: string
    connectedOnly?: boolean
    providerID?: string
  }) => AppEffect<ReadonlyArray<RuntimeModelSummary>>
  listConnectedModels: (origin: string) => AppEffect<ReadonlyArray<RuntimeModelSummary>>
  getOriginState: (origin: string) => AppEffect<import("@llm-bridge/contracts").RuntimeOriginState>
  listPermissions: (origin: string) => AppEffect<ReadonlyArray<import("@llm-bridge/contracts").RuntimePermissionEntry>>
  listPending: (origin: string) => AppEffect<ReadonlyArray<import("@llm-bridge/contracts").RuntimePendingRequest>>
  openProviderAuthWindow: (providerID: string) => AppEffect<import("@llm-bridge/contracts").RuntimeOpenProviderAuthWindowResponse>
  getProviderAuthFlow: (providerID: string) => AppEffect<{
    providerID: string
    result: import("@llm-bridge/contracts").RuntimeAuthFlowSnapshot
  }>
  startProviderAuthFlow: (input: {
    providerID: string
    methodID: string
    values?: Record<string, string>
  }) => AppEffect<import("@llm-bridge/contracts").RuntimeStartProviderAuthFlowResponse>
  cancelProviderAuthFlow: (input: {
    providerID: string
    reason?: string
  }) => AppEffect<import("@llm-bridge/contracts").RuntimeCancelProviderAuthFlowResponse>
  disconnectProvider: (providerID: string) => AppEffect<import("@llm-bridge/contracts").RuntimeDisconnectProviderResponse>
  updatePermission: (input: RuntimeUpdatePermissionInput) => AppEffect<
    | import("@llm-bridge/contracts").RuntimeSetOriginEnabledResponse
    | import("@llm-bridge/contracts").RuntimeUpdatePermissionResponse
  >
  requestPermission: (
    input: RuntimeRequestPermissionInput,
  ) => AppEffect<
    RuntimeCreatePermissionRequestResponse | RuntimeDismissPermissionRequestResponse | RuntimeResolvePermissionRequestResponse
  >
  acquireModel: (input: {
    origin: string
    requestID: string
    sessionID: string
    modelID: string
  }) => AppEffect<import("@llm-bridge/contracts").RuntimeModelDescriptor>
  modelDoGenerate: (input: {
    origin: string
    requestID: string
    sessionID: string
    modelID: string
    options: import("@llm-bridge/contracts").RuntimeModelCallInput["options"]
  }) => AppEffect<import("@llm-bridge/contracts").RuntimeGenerateResponse>
  modelDoStream: (input: {
    origin: string
    requestID: string
    sessionID: string
    modelID: string
    options: import("@llm-bridge/contracts").RuntimeModelCallInput["options"]
  }) => AppEffect<ReadableStream<import("@llm-bridge/contracts").RuntimeStreamPart>>
  abortModelCall: (requestID: string) => AppEffect<void>
}

export class RuntimeApplication extends Context.Tag("@llm-bridge/runtime-core/RuntimeApplication")<
  RuntimeApplication,
  RuntimeApplicationApi
>() {}

export const RuntimeApplicationLive = Layer.effect(
  RuntimeApplication,
  Effect.gen(function*() {
    const catalog = yield* CatalogService
    const query = yield* RuntimeQueryService
    const auth = yield* AuthFlowService
    const permission = yield* PermissionService
    const model = yield* ModelExecutionService

    return {
      startup: () => catalog.ensureCatalog(),
      listProviders: (origin) => Effect.zipRight(Effect.succeed(origin), query.listProviders()),
      listModels: ({ connectedOnly, providerID }) =>
        query.listModels({
          connectedOnly,
          providerID,
        }),
      listConnectedModels: (_origin) =>
        query.listModels({
          connectedOnly: true,
        }),
      getOriginState: (origin) => query.getOriginState(origin),
      listPermissions: (origin) => query.listPermissions(origin),
      listPending: (origin) => query.listPending(origin),
      openProviderAuthWindow: (providerID) => auth.openProviderAuthWindow(providerID),
      getProviderAuthFlow: (providerID) => auth.getProviderAuthFlow(providerID),
      startProviderAuthFlow: (input) => auth.startProviderAuthFlow(input),
      cancelProviderAuthFlow: (input) => auth.cancelProviderAuthFlow(input),
      disconnectProvider: (providerID) => auth.disconnectProvider(providerID),
      updatePermission: (input) =>
        input.mode === "origin"
          ? permission.setOriginEnabled(input.origin, input.enabled)
          : permission.updatePermission({
            origin: input.origin,
            modelID: input.modelId,
            status: input.status,
            capabilities: input.capabilities,
          }),
      requestPermission: (input) => permission.requestPermission(input),
      acquireModel: (input) =>
        model.acquireModel({
          origin: input.origin,
          requestID: input.requestID,
          sessionID: input.sessionID,
          modelID: input.modelID,
        }),
      modelDoGenerate: (input) =>
        model.generateModel({
          origin: input.origin,
          requestID: input.requestID,
          sessionID: input.sessionID,
          modelID: input.modelID,
          options: input.options,
        }),
      modelDoStream: (input) =>
        model.streamModel({
          origin: input.origin,
          requestID: input.requestID,
          sessionID: input.sessionID,
          modelID: input.modelID,
          options: input.options,
        }),
      abortModelCall: (requestID) => model.abortModelCall(requestID),
    } satisfies RuntimeApplicationApi
  }),
).pipe(
  Layer.provide(
    Layer.mergeAll(
      RuntimeQueryServiceLive,
      AuthFlowServiceLive.pipe(Layer.provideMerge(CatalogServiceLive)),
      ModelExecutionServiceLive.pipe(Layer.provideMerge(PermissionServiceLive)),
    ),
  ),
)
