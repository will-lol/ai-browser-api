import {
  RuntimeAdminRpcGroup,
  RuntimePublicRpcGroup,
  RuntimeValidationError,
  isRuntimeRpcError,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import { RuntimeApplication } from "@llm-bridge/runtime-core";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  wrapExtensionError,
  wrapTransportError,
} from "@/lib/runtime/errors";

function serializeUnknownRuntimeError(error: unknown): RuntimeRpcError {
  if (isRuntimeRpcError(error)) return error;
  return wrapExtensionError(error, "runtime.rpc");
}

function serializeRpcError<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, RuntimeRpcError, R> {
  return Effect.mapError(effect, serializeUnknownRuntimeError);
}

function serializeRpcStream<A, E, R>(
  effect: Effect.Effect<ReadableStream<A>, E, R>,
): Stream.Stream<A, RuntimeRpcError, R> {
  return Stream.unwrap(
    Effect.map(serializeRpcError(effect), (stream) =>
      Stream.fromReadableStream(() => stream, (error) =>
        isRuntimeRpcError(error) ? error : wrapTransportError(error),
      ),
    ),
  );
}

function requireOrigin(operation: string, origin: string | undefined) {
  return Effect.fromNullable(origin).pipe(
    Effect.mapError(
      () =>
        new RuntimeValidationError({
          message: `${operation} requires origin`,
        }),
    ),
  );
}

export const makeRuntimePublicRpcHandlers = Effect.gen(function* () {
  const app = yield* RuntimeApplication;

  return RuntimePublicRpcGroup.of({
    getOriginState: ({ origin }) => serializeRpcError(app.getOriginState(origin)),
    listPending: ({ origin }) => serializeRpcError(app.listPending(origin)),
    acquireModel: ({ origin, requestId, sessionID, modelId }) =>
      serializeRpcError(
        app.acquireModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
        }),
      ),
    modelDoGenerate: ({ origin, requestId, sessionID, modelId, options }) =>
      serializeRpcError(
        app.modelDoGenerate({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      ),
    modelDoStream: ({ origin, requestId, sessionID, modelId, options }) =>
      serializeRpcStream(
        app.modelDoStream({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      ),
    abortModelCall: ({ origin, sessionID, requestId }) =>
      serializeRpcError(
        app.abortModelCall({
          origin,
          sessionID,
          requestID: requestId,
        }),
      ),
    listModels: ({ origin, connectedOnly, providerID }) =>
      serializeRpcError(
        Effect.gen(function* () {
          yield* app.ensureOriginEnabled(yield* requireOrigin("listModels", origin));
          return yield* app.listModels({ connectedOnly, providerID });
        }),
      ),
    requestPermission: (input) =>
      serializeRpcError(
        Effect.gen(function* () {
          yield* app.ensureOriginEnabled(input.origin);
          const result = yield* app.requestPermission(input);
          if (!("status" in result)) {
            return yield* Effect.fail(
              new RuntimeValidationError({
                message: "Unexpected permission response for create action",
              }),
            );
          }
          return result;
        }),
      ),
  });
});

export const RuntimePublicRpcHandlersLive = RuntimePublicRpcGroup.toLayer(
  makeRuntimePublicRpcHandlers,
);

export const makeRuntimeAdminRpcHandlers = Effect.gen(function* () {
  const app = yield* RuntimeApplication;

  return RuntimeAdminRpcGroup.of({
    getOriginState: ({ origin }) => serializeRpcError(app.getOriginState(origin)),
    listPending: ({ origin }) => serializeRpcError(app.listPending(origin)),
    acquireModel: ({ origin, requestId, sessionID, modelId }) =>
      serializeRpcError(
        app.acquireModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
        }),
      ),
    modelDoGenerate: ({ origin, requestId, sessionID, modelId, options }) =>
      serializeRpcError(
        app.modelDoGenerate({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      ),
    modelDoStream: ({ origin, requestId, sessionID, modelId, options }) =>
      serializeRpcStream(
        app.modelDoStream({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      ),
    abortModelCall: ({ origin, sessionID, requestId }) =>
      serializeRpcError(
        app.abortModelCall({
          origin,
          sessionID,
          requestID: requestId,
        }),
      ),
    listProviders: () => serializeRpcError(app.listProviders()),
    listConnectedModels: () => serializeRpcError(app.listConnectedModels()),
    listPermissions: ({ origin }) => serializeRpcError(app.listPermissions(origin)),
    openProviderAuthWindow: ({ providerID }) =>
      serializeRpcError(app.openProviderAuthWindow(providerID)),
    getProviderAuthFlow: ({ providerID }) =>
      serializeRpcError(app.getProviderAuthFlow(providerID)),
    startProviderAuthFlow: ({ providerID, methodID, values }) =>
      serializeRpcError(
        app.startProviderAuthFlow({
          providerID,
          methodID,
          values,
        }),
      ),
    cancelProviderAuthFlow: ({ providerID, reason }) =>
      serializeRpcError(
        app.cancelProviderAuthFlow({
          providerID,
          reason,
        }),
      ),
    disconnectProvider: ({ providerID }) =>
      serializeRpcError(app.disconnectProvider(providerID)),
    updatePermission: (input) => serializeRpcError(app.updatePermission(input)),
    listModels: ({ connectedOnly, providerID }) =>
      serializeRpcError(
        app.listModels({
          connectedOnly,
          providerID,
        }),
      ),
    requestPermission: (input) => serializeRpcError(app.requestPermission(input)),
  });
});

export const RuntimeAdminRpcHandlersLive = RuntimeAdminRpcGroup.toLayer(
  makeRuntimeAdminRpcHandlers,
);
