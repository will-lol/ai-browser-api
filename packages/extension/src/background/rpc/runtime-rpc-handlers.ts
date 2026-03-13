import {
  RuntimeAdminRpcGroup,
  RuntimeDefectError,
  RuntimeInternalError,
  RuntimePublicRpcGroup,
  RuntimeValidationError,
  isRuntimeRpcError,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import {
  abortChatStream,
  abortModelCall,
  acquireModel,
  cancelProviderAuthFlow,
  createPermissionRequest,
  dismissPermissionRequest,
  disconnectProvider,
  ensureOriginEnabled,
  getOriginState,
  getProviderAuthFlow,
  listConnectedModels,
  listModels,
  listPending,
  listPermissions,
  listProviders,
  openProviderAuthWindow,
  reconnectChatStream,
  resolvePermissionRequest,
  sendChatMessages,
  setModelPermission,
  setOriginEnabled,
  startProviderAuthFlow,
  streamModel,
  streamModels,
  streamOriginState,
  streamPending,
  streamPermissions,
  streamProviderAuthFlow,
  streamProviders,
  generateModel,
} from "@llm-bridge/runtime-core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

function serializeUnknownRuntimeError(error: unknown): RuntimeRpcError {
  if (isRuntimeRpcError(error)) {
    return error;
  }

  return new RuntimeInternalError({
    operation: "runtime.rpc",
    message: error instanceof Error ? error.message : String(error),
  });
}

function serializeRuntimeCause(cause: Cause.Cause<unknown>): RuntimeRpcError {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    return serializeUnknownRuntimeError(failure.value);
  }

  const defect = Cause.squash(cause);
  console.error("[runtime-rpc] unexpected defect", {
    defect,
    pretty: Cause.pretty(cause),
  });

  return new RuntimeDefectError({
    defect: String(defect),
  });
}

export function serializeRpcError<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, RuntimeRpcError, R> {
  return Effect.catchAllCause(effect, (cause) =>
    Effect.fail(serializeRuntimeCause(cause)),
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

const makePublicRuntimeRpcHandlers = Effect.sync(() =>
  RuntimePublicRpcGroup.of({
    listModels: ({ origin, connectedOnly, providerID }) =>
      serializeRpcError(
        origin
          ? Effect.gen(function* () {
              yield* ensureOriginEnabled(
                yield* requireOrigin("listModels", origin),
              );
              return yield* listModels({
                connectedOnly,
                providerID,
              });
            })
          : listModels({
              connectedOnly,
              providerID,
            }),
      ),
    getOriginState: ({ origin }) => serializeRpcError(getOriginState(origin)),
    listPending: ({ origin }) => serializeRpcError(listPending(origin)),
    acquireModel: ({ origin, requestId, sessionID, modelId }) =>
      serializeRpcError(
        acquireModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
        }),
      ),
    modelDoGenerate: ({ origin, requestId, sessionID, modelId, options }) =>
      serializeRpcError(
        generateModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      ),
    modelDoStream: ({ origin, requestId, sessionID, modelId, options }) =>
      streamModel({
        origin,
        requestID: requestId,
        sessionID,
        modelID: modelId,
        options,
      }),
    abortModelCall: ({ origin, sessionID, requestId }) =>
      serializeRpcError(
        abortModelCall({
          origin,
          sessionID,
          requestID: requestId,
        }),
      ),
    chatSendMessages: (input) => sendChatMessages(input),
    chatReconnectStream: (input) => reconnectChatStream(input),
    abortChatStream: (input) => serializeRpcError(abortChatStream(input)),
    createPermissionRequest: (input) =>
      serializeRpcError(
        Effect.gen(function* () {
          yield* ensureOriginEnabled(input.origin);
          return yield* createPermissionRequest(input);
        }),
      ),
  }),
);

const makeAdminRuntimeRpcHandlers = Effect.sync(() =>
  RuntimeAdminRpcGroup.of({
    listModels: ({ origin, connectedOnly, providerID }) =>
      serializeRpcError(
        origin
          ? Effect.gen(function* () {
              yield* ensureOriginEnabled(
                yield* requireOrigin("listModels", origin),
              );
              return yield* listModels({
                connectedOnly,
                providerID,
              });
            })
          : listModels({
              connectedOnly,
              providerID,
            }),
      ),
    streamModels: ({ origin, connectedOnly, providerID }) =>
      Stream.unwrap(
        serializeRpcError(
          origin
            ? Effect.gen(function* () {
                yield* ensureOriginEnabled(
                  yield* requireOrigin("streamModels", origin),
                );
                return streamModels({
                  connectedOnly,
                  providerID,
                });
              })
            : Effect.succeed(
                streamModels({
                  connectedOnly,
                  providerID,
                }),
              ),
        ),
      ),
    getOriginState: ({ origin }) => serializeRpcError(getOriginState(origin)),
    streamOriginState: ({ origin }) => streamOriginState(origin),
    listPending: ({ origin }) => serializeRpcError(listPending(origin)),
    streamPending: ({ origin }) => streamPending(origin),
    acquireModel: ({ origin, requestId, sessionID, modelId }) =>
      serializeRpcError(
        acquireModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
        }),
      ),
    modelDoGenerate: ({ origin, requestId, sessionID, modelId, options }) =>
      serializeRpcError(
        generateModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      ),
    modelDoStream: ({ origin, requestId, sessionID, modelId, options }) =>
      streamModel({
        origin,
        requestID: requestId,
        sessionID,
        modelID: modelId,
        options,
      }),
    abortModelCall: ({ origin, sessionID, requestId }) =>
      serializeRpcError(
        abortModelCall({
          origin,
          sessionID,
          requestID: requestId,
        }),
      ),
    chatSendMessages: (input) => sendChatMessages(input),
    chatReconnectStream: (input) => reconnectChatStream(input),
    abortChatStream: (input) => serializeRpcError(abortChatStream(input)),
    createPermissionRequest: (input) =>
      serializeRpcError(
        Effect.gen(function* () {
          yield* ensureOriginEnabled(input.origin);
          return yield* createPermissionRequest(input);
        }),
      ),
    listProviders: () => serializeRpcError(listProviders()),
    streamProviders: () => streamProviders(),
    listConnectedModels: () => serializeRpcError(listConnectedModels()),
    listPermissions: ({ origin }) => serializeRpcError(listPermissions(origin)),
    streamPermissions: ({ origin }) => streamPermissions(origin),
    openProviderAuthWindow: ({ providerID }) =>
      serializeRpcError(openProviderAuthWindow(providerID)),
    getProviderAuthFlow: ({ providerID }) =>
      serializeRpcError(getProviderAuthFlow(providerID)),
    streamProviderAuthFlow: ({ providerID }) =>
      streamProviderAuthFlow(providerID),
    startProviderAuthFlow: ({ providerID, methodID, values }) =>
      serializeRpcError(
        startProviderAuthFlow({
          providerID,
          methodID,
          values,
        }),
      ),
    cancelProviderAuthFlow: ({ providerID, reason }) =>
      serializeRpcError(
        cancelProviderAuthFlow({
          providerID,
          reason,
        }),
      ),
    disconnectProvider: ({ providerID }) =>
      serializeRpcError(disconnectProvider(providerID)),
    setOriginEnabled: ({ origin, enabled }) =>
      serializeRpcError(setOriginEnabled(origin, enabled)),
    setModelPermission: ({ origin, modelId, status, capabilities }) =>
      serializeRpcError(
        setModelPermission({
          origin,
          modelID: modelId,
          status,
          capabilities,
        }),
      ),
    resolvePermissionRequest: (input) =>
      serializeRpcError(resolvePermissionRequest(input)),
    dismissPermissionRequest: ({ requestId }) =>
      serializeRpcError(dismissPermissionRequest(requestId)),
  }),
);

export const RuntimePublicRpcHandlersLive = RuntimePublicRpcGroup.toLayer(
  makePublicRuntimeRpcHandlers,
);

export const RuntimeAdminRpcHandlersLive = RuntimeAdminRpcGroup.toLayer(
  makeAdminRuntimeRpcHandlers,
);
