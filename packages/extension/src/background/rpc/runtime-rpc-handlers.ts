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

function handleListModels(input: {
  origin?: string;
  connectedOnly?: boolean;
  providerID?: string;
}) {
  return serializeRpcError(
    input.origin
      ? Effect.gen(function* () {
          yield* ensureOriginEnabled(
            yield* requireOrigin("listModels", input.origin),
          );
          return yield* listModels({
            connectedOnly: input.connectedOnly,
            providerID: input.providerID,
          });
        })
      : listModels({
          connectedOnly: input.connectedOnly,
          providerID: input.providerID,
        }),
  );
}

function handleStreamModels(input: {
  origin?: string;
  connectedOnly?: boolean;
  providerID?: string;
}) {
  return Stream.unwrap(
    serializeRpcError(
      input.origin
        ? Effect.gen(function* () {
            yield* ensureOriginEnabled(
              yield* requireOrigin("streamModels", input.origin),
            );
            return streamModels({
              connectedOnly: input.connectedOnly,
              providerID: input.providerID,
            });
          })
        : Effect.succeed(
            streamModels({
              connectedOnly: input.connectedOnly,
              providerID: input.providerID,
            }),
          ),
    ),
  );
}

function handleAcquireModel(input: {
  origin: string;
  requestId: string;
  sessionID: string;
  modelId: string;
}) {
  return serializeRpcError(
    acquireModel({
      origin: input.origin,
      requestID: input.requestId,
      sessionID: input.sessionID,
      modelID: input.modelId,
    }),
  );
}

function handleModelDoGenerate(input: {
  origin: string;
  requestId: string;
  sessionID: string;
  modelId: string;
  options: Parameters<typeof generateModel>[0]["options"];
}) {
  return serializeRpcError(
    generateModel({
      origin: input.origin,
      requestID: input.requestId,
      sessionID: input.sessionID,
      modelID: input.modelId,
      options: input.options,
    }),
  );
}

function handleModelDoStream(input: {
  origin: string;
  requestId: string;
  sessionID: string;
  modelId: string;
  options: Parameters<typeof streamModel>[0]["options"];
}) {
  return streamModel({
    origin: input.origin,
    requestID: input.requestId,
    sessionID: input.sessionID,
    modelID: input.modelId,
    options: input.options,
  });
}

function handleAbortModelCall(input: {
  origin: string;
  sessionID: string;
  requestId: string;
}) {
  return serializeRpcError(
    abortModelCall({
      origin: input.origin,
      sessionID: input.sessionID,
      requestID: input.requestId,
    }),
  );
}

function handleCreatePermissionRequest(input: Parameters<
  typeof createPermissionRequest
>[0]) {
  return serializeRpcError(
    Effect.gen(function* () {
      yield* ensureOriginEnabled(input.origin);
      return yield* createPermissionRequest(input);
    }),
  );
}

const makePublicRuntimeRpcHandlers = Effect.sync(() =>
  RuntimePublicRpcGroup.of({
    listModels: handleListModels,
    streamModels: handleStreamModels,
    getOriginState: ({ origin }) => serializeRpcError(getOriginState(origin)),
    listPending: ({ origin }) => serializeRpcError(listPending(origin)),
    acquireModel: handleAcquireModel,
    modelDoGenerate: handleModelDoGenerate,
    modelDoStream: handleModelDoStream,
    abortModelCall: handleAbortModelCall,
    chatSendMessages: (input) => sendChatMessages(input),
    chatReconnectStream: (input) => reconnectChatStream(input),
    abortChatStream: (input) => serializeRpcError(abortChatStream(input)),
    createPermissionRequest: handleCreatePermissionRequest,
  }),
);

const makeAdminRuntimeRpcHandlers = Effect.sync(() =>
  RuntimeAdminRpcGroup.of({
    listModels: handleListModels,
    streamModels: handleStreamModels,
    getOriginState: ({ origin }) => serializeRpcError(getOriginState(origin)),
    streamOriginState: ({ origin }) => streamOriginState(origin),
    listPending: ({ origin }) => serializeRpcError(listPending(origin)),
    streamPending: ({ origin }) => streamPending(origin),
    acquireModel: handleAcquireModel,
    modelDoGenerate: handleModelDoGenerate,
    modelDoStream: handleModelDoStream,
    abortModelCall: handleAbortModelCall,
    chatSendMessages: (input) => sendChatMessages(input),
    chatReconnectStream: (input) => reconnectChatStream(input),
    abortChatStream: (input) => serializeRpcError(abortChatStream(input)),
    createPermissionRequest: handleCreatePermissionRequest,
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
