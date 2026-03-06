import {
  RuntimeAdminRpcGroup,
  RuntimePublicRpcGroup,
  RuntimeValidationError,
  toRuntimeRpcError,
  type RuntimeRpcError,
} from "@llm-bridge/contracts"
import { RuntimeApplication } from "@llm-bridge/runtime-core"
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

export const makeRuntimePublicRpcHandlers = Effect.gen(function*() {
  const app = yield* RuntimeApplication

  return RuntimePublicRpcGroup.of({
    listModels: ({ origin, connectedOnly, providerID }) =>
      mapRpcError(
        Effect.gen(function*() {
          yield* app.ensureOriginEnabled(origin)
          return yield* app.listModels({
            origin,
            connectedOnly,
            providerID,
          })
        }),
      ),
    getOriginState: ({ origin }) => mapRpcError(app.getOriginState(origin)),
    listPending: ({ origin }) => mapRpcError(app.listPending(origin)),
    requestPermission: (input) =>
      mapRpcError(
        Effect.gen(function*() {
          yield* app.ensureOriginEnabled(input.origin)
          const result = yield* app.requestPermission(input)
          if (!("status" in result)) {
            return yield* new RuntimeValidationError({
              message: "Unexpected permission response for create action",
            })
          }
          return result
        }),
      ),
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
  })
})

export const RuntimePublicRpcHandlersLive = RuntimePublicRpcGroup.toLayer(makeRuntimePublicRpcHandlers)

export const makeRuntimeAdminRpcHandlers = Effect.gen(function*() {
  const app = yield* RuntimeApplication

  return RuntimeAdminRpcGroup.of({
    listProviders: ({ origin }) => mapRpcError(app.listProviders(origin)),
    listModels: ({ origin, connectedOnly, providerID }) =>
      mapRpcError(
        app.listModels({
          origin,
          connectedOnly,
          providerID,
        }),
      ),
    listConnectedModels: ({ origin }) => mapRpcError(app.listConnectedModels(origin)),
    getOriginState: ({ origin }) => mapRpcError(app.getOriginState(origin)),
    listPermissions: ({ origin }) => mapRpcError(app.listPermissions(origin)),
    listPending: ({ origin }) => mapRpcError(app.listPending(origin)),
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
    requestPermission: (input) => mapRpcError(app.requestPermission(input)),
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
  })
})

export const RuntimeAdminRpcHandlersLive = RuntimeAdminRpcGroup.toLayer(makeRuntimeAdminRpcHandlers)
