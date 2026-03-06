import {
  RuntimeAdminRpcGroup,
  RuntimePublicRpcGroup,
  RuntimeValidationError,
  toRuntimeRpcError,
  type RuntimeRpcError,
} from "@llm-bridge/contracts"
import {
  RuntimeApplication,
  type RuntimeApplicationApi,
} from "@llm-bridge/runtime-core"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

function mapRpcError<A>(
  effect: Effect.Effect<A, RuntimeRpcError | unknown>,
): Effect.Effect<A, RuntimeRpcError> {
  const normalized = Effect.mapError(effect, toRuntimeRpcError)

  return normalized.pipe(
    Effect.catchTag("RuntimeAuthorizationError", (error) => Effect.fail(error)),
    Effect.catchTag("RuntimeUpstreamServiceError", (error) => Effect.fail(error)),
    Effect.catchTag("RuntimeAuthProviderError", (error) => Effect.fail(error)),
    Effect.catchTag("RuntimeInternalError", (error) => Effect.fail(error)),
    Effect.catchTag("RuntimeValidationError", (error) => Effect.fail(error)),
    Effect.catchTag("PermissionDeniedError", (error) => Effect.fail(error)),
    Effect.catchTag("ModelNotFoundError", (error) => Effect.fail(error)),
    Effect.catchTag("ProviderNotConnectedError", (error) => Effect.fail(error)),
    Effect.catchTag("AuthFlowExpiredError", (error) => Effect.fail(error)),
    Effect.catchTag("TransportProtocolError", (error) => Effect.fail(error)),
  )
}

function mapRpcStream<A>(
  effect: Effect.Effect<ReadableStream<A>, RuntimeRpcError | unknown>,
): Stream.Stream<A, RuntimeRpcError> {
  return Stream.unwrap(
    mapRpcError(effect).pipe(
      Effect.map((stream) => Stream.fromReadableStream(() => stream, toRuntimeRpcError)),
    ),
  )
}

type RuntimePublicRpcHandlers = Parameters<typeof RuntimePublicRpcGroup.of>[0]
type RuntimeAdminRpcHandlers = Parameters<typeof RuntimeAdminRpcGroup.of>[0]

type RuntimeSharedHandlerKeys =
  | "getOriginState"
  | "listPending"
  | "acquireModel"
  | "modelDoGenerate"
  | "modelDoStream"
  | "abortModelCall"

type RuntimeSharedRpcHandlers = Pick<RuntimePublicRpcHandlers, RuntimeSharedHandlerKeys>

type RuntimeAdminOnlyHandlerKeys =
  | "listProviders"
  | "listConnectedModels"
  | "listPermissions"
  | "openProviderAuthWindow"
  | "getProviderAuthFlow"
  | "startProviderAuthFlow"
  | "cancelProviderAuthFlow"
  | "disconnectProvider"
  | "updatePermission"

type RuntimeAdminOnlyRpcHandlers = Pick<RuntimeAdminRpcHandlers, RuntimeAdminOnlyHandlerKeys>

function requireOrigin(operation: string, origin: string | undefined) {
  return Effect.fromNullable(origin).pipe(
    Effect.mapError(() =>
      new RuntimeValidationError({
        message: `${operation} requires origin`,
      })),
  )
}

function makeRuntimeSharedRpcHandlers(
  app: RuntimeApplicationApi,
){
  return {
    getOriginState: ({ origin }) => mapRpcError(app.getOriginState(origin)),
    listPending: ({ origin }) => mapRpcError(app.listPending(origin)),
    acquireModel: ({ origin, requestId, sessionID, modelId }) =>
      mapRpcError(
        app.acquireModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
        }),
      ),
    modelDoGenerate: ({ origin, requestId, sessionID, modelId, options }) =>
      mapRpcError(
        app.modelDoGenerate({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      ),
    modelDoStream: ({ origin, requestId, sessionID, modelId, options }) =>
      mapRpcStream(
        app.modelDoStream({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      ),
    abortModelCall: ({ origin, sessionID, requestId }) =>
      mapRpcError(
        app.abortModelCall({
          origin,
          sessionID,
          requestID: requestId,
        }),
      ),
  } satisfies RuntimeSharedRpcHandlers
}

function makePublicListModelsHandler(
  app: RuntimeApplicationApi,
){
  return (({ origin, connectedOnly, providerID }) =>
    mapRpcError(
      Effect.gen(function*() {
        yield* app.ensureOriginEnabled(yield* requireOrigin("listModels", origin))

        return yield* app.listModels({
          connectedOnly,
          providerID,
        })
      }),
    )) satisfies RuntimePublicRpcHandlers["listModels"]
}

function makeAdminListModelsHandler(
  app: RuntimeApplicationApi,
){
  return (({ connectedOnly, providerID }) =>
    mapRpcError(
      app.listModels({
        connectedOnly,
        providerID,
      }),
    )) satisfies RuntimeAdminRpcHandlers["listModels"]
}

function makePublicRequestPermissionHandler(
  app: RuntimeApplicationApi,
){
  return ((input) =>
    mapRpcError(
      Effect.gen(function*() {
        yield* app.ensureOriginEnabled(input.origin)
        const result = yield* app.requestPermission(input)
        if (!("status" in result)) {
          return yield* Effect.fail(
            new RuntimeValidationError({
              message: "Unexpected permission response for create action",
            }),
          )
        }
        return result
      }),
    )) satisfies RuntimePublicRpcHandlers["requestPermission"]
}

function makeAdminRequestPermissionHandler(
  app: RuntimeApplicationApi,
){
  return ((input) => mapRpcError(app.requestPermission(input))) satisfies RuntimeAdminRpcHandlers["requestPermission"]
}

function makeRuntimeAdminOnlyRpcHandlers(
  app: RuntimeApplicationApi,
){
  return {
    listProviders: () => mapRpcError(app.listProviders()),
    listConnectedModels: () => mapRpcError(app.listConnectedModels()),
    listPermissions: ({ origin }) => mapRpcError(app.listPermissions(origin)),
    openProviderAuthWindow: ({ providerID }) => mapRpcError(app.openProviderAuthWindow(providerID)),
    getProviderAuthFlow: ({ providerID }) => mapRpcError(app.getProviderAuthFlow(providerID)),
    startProviderAuthFlow: ({ providerID, methodID, values }) =>
      mapRpcError(
        app.startProviderAuthFlow({
          providerID,
          methodID,
          values,
        }),
      ),
    cancelProviderAuthFlow: ({ providerID, reason }) =>
      mapRpcError(
        app.cancelProviderAuthFlow({
          providerID,
          reason,
        }),
      ),
    disconnectProvider: ({ providerID }) => mapRpcError(app.disconnectProvider(providerID)),
    updatePermission: (input) => mapRpcError(app.updatePermission(input)),
  } satisfies RuntimeAdminOnlyRpcHandlers
}

export const makeRuntimePublicRpcHandlers = Effect.gen(function*() {
  const app = yield* RuntimeApplication

  return RuntimePublicRpcGroup.of({
    ...makeRuntimeSharedRpcHandlers(app),
    listModels: makePublicListModelsHandler(app),
    requestPermission: makePublicRequestPermissionHandler(app),
  })
})

export const RuntimePublicRpcHandlersLive = RuntimePublicRpcGroup.toLayer(makeRuntimePublicRpcHandlers)

export const makeRuntimeAdminRpcHandlers = Effect.gen(function*() {
  const app = yield* RuntimeApplication

  return RuntimeAdminRpcGroup.of({
    ...makeRuntimeSharedRpcHandlers(app),
    ...makeRuntimeAdminOnlyRpcHandlers(app),
    listModels: makeAdminListModelsHandler(app),
    requestPermission: makeAdminRequestPermissionHandler(app),
  })
})

export const RuntimeAdminRpcHandlersLive = RuntimeAdminRpcGroup.toLayer(makeRuntimeAdminRpcHandlers)
