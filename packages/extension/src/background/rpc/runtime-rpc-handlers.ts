import {
  RuntimeRpcGroup,
  RuntimeInternalError,
  RuntimeValidationError,
  isRuntimeRpcError,
  type RuntimeRpcError,
} from "@llm-bridge/contracts";
import {
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
  resolvePermissionRequest,
  setModelPermission,
  setOriginEnabled,
  startProviderAuthFlow,
  streamModel,
  generateModel,
} from "@llm-bridge/runtime-core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { ChatExecutionService } from "@/background/runtime/execution/chat-execution-service";
import { wrapTransportError } from "@/background/runtime/core/errors";

function serializeUnknownRuntimeError(error: unknown): RuntimeRpcError {
  if (isRuntimeRpcError(error)) return error;
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
  return serializeUnknownRuntimeError(defect);
}

export function serializeRpcError<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, RuntimeRpcError, R> {
  return Effect.catchAllCause(effect, (cause) =>
    Effect.fail(serializeRuntimeCause(cause)),
  );
}

function serializeRpcStream<A, E, R>(
  effect: Effect.Effect<ReadableStream<A>, E, R>,
): Stream.Stream<A, RuntimeRpcError, R> {
  return Stream.unwrap(
    Effect.map(serializeRpcError(effect), (stream) =>
      Stream.fromReadableStream(
        () => stream,
        (error) =>
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

const makeRuntimeRpcHandlers = Effect.gen(function* () {
  const chat = yield* ChatExecutionService;

  return RuntimeRpcGroup.of({
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
      serializeRpcStream(
        streamModel({
          origin,
          requestID: requestId,
          sessionID,
          modelID: modelId,
          options,
        }),
      ),
    abortModelCall: ({ origin, sessionID, requestId }) =>
      serializeRpcError(
        abortModelCall({
          origin,
          sessionID,
          requestID: requestId,
        }),
      ),
    chatSendMessages: (input) => serializeRpcStream(chat.sendMessages(input)),
    chatReconnectStream: (input) =>
      serializeRpcStream(chat.reconnectStream(input)),
    abortChatStream: (input) => serializeRpcError(chat.abortStream(input)),
    listModels: ({ origin, connectedOnly, providerID }) =>
      serializeRpcError(
        origin
          ? Effect.gen(function* () {
              yield* ensureOriginEnabled(
                yield* requireOrigin("listModels", origin),
              );
              return yield* listModels({ connectedOnly, providerID });
            })
          : listModels({ connectedOnly, providerID }),
      ),
    createPermissionRequest: (input) =>
      serializeRpcError(
        Effect.gen(function* () {
          yield* ensureOriginEnabled(input.origin);
          return yield* createPermissionRequest(input);
        }),
      ),
    listProviders: () => serializeRpcError(listProviders()),
    listConnectedModels: () => serializeRpcError(listConnectedModels()),
    listPermissions: ({ origin }) => serializeRpcError(listPermissions(origin)),
    openProviderAuthWindow: ({ providerID }) =>
      serializeRpcError(openProviderAuthWindow(providerID)),
    getProviderAuthFlow: ({ providerID }) =>
      serializeRpcError(getProviderAuthFlow(providerID)),
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
  });
});

const RuntimeRpcHandlersLive = RuntimeRpcGroup.toLayer(makeRuntimeRpcHandlers);

export const RuntimePublicRpcHandlersLive = RuntimeRpcHandlersLive;
export const RuntimeAdminRpcHandlersLive = RuntimeRpcHandlersLive;
