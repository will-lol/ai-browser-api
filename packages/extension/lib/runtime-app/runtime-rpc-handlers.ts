import {
  AuthFlowExpiredError,
  ModelNotFoundError,
  PermissionDeniedError,
  ProviderNotConnectedError,
  RuntimeRpcGroup,
  RuntimeValidationError,
  TransportProtocolError,
  type RuntimeRpcError,
} from "@llm-bridge/contracts"
import { RuntimeApplication } from "@llm-bridge/runtime-core"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

function toRuntimeRpcError(error: unknown): RuntimeRpcError {
  if (
    error instanceof PermissionDeniedError
    || error instanceof ModelNotFoundError
    || error instanceof ProviderNotConnectedError
    || error instanceof AuthFlowExpiredError
    || error instanceof TransportProtocolError
    || error instanceof RuntimeValidationError
  ) {
    return error
  }

  return new RuntimeValidationError({
    message: error instanceof Error ? error.message : String(error),
  })
}

function safeEffect<A>(effect: Effect.Effect<A, unknown>) {
  return Effect.catchAll(effect, (error) => Effect.fail(toRuntimeRpcError(error)))
}

function safeStream<A>(stream: Stream.Stream<A, unknown>) {
  return Stream.mapError(stream, toRuntimeRpcError)
}

export const RuntimeRpcHandlersLive = RuntimeRpcGroup.toLayer(
  Effect.gen(function*() {
    const app = yield* RuntimeApplication

    return RuntimeRpcGroup.of({
      listProviders: ({ origin }) => safeEffect(app.listProviders(origin)),
      listModels: ({ origin, connectedOnly, providerID }) =>
        safeEffect(app.listModels({
          origin,
          connectedOnly,
          providerID,
        })),
      listConnectedModels: ({ origin }) => safeEffect(app.listConnectedModels(origin)),
      getOriginState: ({ origin }) => safeEffect(app.getOriginState(origin)),
      listPermissions: ({ origin }) => safeEffect(app.listPermissions(origin)),
      listPending: ({ origin }) => safeEffect(app.listPending(origin)),
      openProviderAuthWindow: ({ providerID }) => safeEffect(app.openProviderAuthWindow(providerID)),
      getProviderAuthFlow: ({ providerID }) => safeEffect(app.getProviderAuthFlow(providerID)),
      startProviderAuthFlow: ({ providerID, methodID, values }) =>
        safeEffect(app.startProviderAuthFlow({
          providerID,
          methodID,
          values,
        })),
      cancelProviderAuthFlow: ({ providerID, reason }) =>
        safeEffect(app.cancelProviderAuthFlow({
          providerID,
          reason,
        })),
      disconnectProvider: ({ providerID }) => safeEffect(app.disconnectProvider(providerID)),
      updatePermission: (input) => safeEffect(app.updatePermission(input)),
      requestPermission: (input) => safeEffect(app.requestPermission(input)),
      acquireModel: ({ origin, requestId, sessionID, modelId }) =>
        safeEffect(app.acquireModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
        })),
      modelDoGenerate: ({ origin, requestId, sessionID, modelId, options }) =>
        safeEffect(app.modelDoGenerate({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        })),
      modelDoStream: ({ origin, requestId, sessionID, modelId, options }) =>
        safeStream(Stream.unwrap(
          safeEffect(Effect.map(
            app.modelDoStream({
              origin,
              requestID: requestId,
              sessionID,
              modelID: modelId,
              options,
            }),
            (stream) => Stream.fromReadableStream(() => stream, toRuntimeRpcError),
          )),
        )),
      abortModelCall: ({ requestId }) => safeEffect(app.abortModelCall(requestId)),
    })
  }),
)
