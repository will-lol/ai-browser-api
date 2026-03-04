import {
  RuntimeRpcGroup,
  RuntimeValidationError,
} from "@llm-bridge/contracts"
import { RuntimeApplication } from "@llm-bridge/runtime-core"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

function toValidationError(error: unknown) {
  return new RuntimeValidationError({
    message: error instanceof Error ? error.message : String(error),
  })
}

export const RuntimeRpcHandlersLive = RuntimeRpcGroup.toLayer(
  Effect.gen(function*() {
    const app = yield* RuntimeApplication

    return RuntimeRpcGroup.of({
      listProviders: ({ origin }) => app.listProviders(origin),
      listModels: ({ origin, connectedOnly, providerID }) =>
        app.listModels({
          origin,
          connectedOnly,
          providerID,
        }),
      listConnectedModels: ({ origin }) => app.listConnectedModels(origin),
      getOriginState: ({ origin }) => app.getOriginState(origin),
      listPermissions: ({ origin }) => app.listPermissions(origin),
      listPending: ({ origin }) => app.listPending(origin),
      openProviderAuthWindow: ({ providerID }) => app.openProviderAuthWindow(providerID),
      getProviderAuthFlow: ({ providerID }) => app.getProviderAuthFlow(providerID),
      startProviderAuthFlow: ({ providerID, methodID, values }) =>
        app.startProviderAuthFlow({
          providerID,
          methodID,
          values,
        }),
      cancelProviderAuthFlow: ({ providerID, reason }) =>
        app.cancelProviderAuthFlow({
          providerID,
          reason,
        }),
      disconnectProvider: ({ providerID }) => app.disconnectProvider(providerID),
      updatePermission: (input) => app.updatePermission(input),
      requestPermission: (input) => app.requestPermission(input),
      acquireModel: ({ origin, requestId, sessionID, modelId }) =>
        app.acquireModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
        }),
      modelDoGenerate: ({ origin, requestId, sessionID, modelId, options }) =>
        app.modelDoGenerate({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      modelDoStream: ({ origin, requestId, sessionID, modelId, options }) =>
        Stream.unwrap(
          Effect.map(
            app.modelDoStream({
              origin,
              requestID: requestId,
              sessionID,
              modelID: modelId,
              options,
            }),
            (stream) => Stream.fromReadableStream(() => stream, toValidationError),
          ),
        ),
      abortModelCall: ({ requestId }) => app.abortModelCall(requestId),
    })
  }),
)
