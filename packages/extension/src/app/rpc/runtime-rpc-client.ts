import {
  type RuntimeAdminRpc,
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeAdminRpcGroup,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  makeRuntimeRpcClientCore,
  type RuntimeRpcClientConnection,
} from "@/shared/rpc/runtime-rpc-client-core";

const CONNECTION_INVALIDATED_MESSAGE =
  "Runtime connection was destroyed while connecting";

const core = makeRuntimeRpcClientCore({
  portName: RUNTIME_ADMIN_RPC_PORT_NAME,
  rpcGroup: RuntimeAdminRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: CONNECTION_INVALIDATED_MESSAGE,
    }),
});

function createRuntimeAdminRpcClient(input: {
  readonly ensureClient: Effect.Effect<
    RuntimeRpcClientConnection<RuntimeAdminRpc>,
    RuntimeValidationError
  >;
}) {
  return {
    listModels: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["listModels"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listModels(payload),
      ),
    getOriginState: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["getOriginState"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.getOriginState(payload),
      ),
    listPending: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["listPending"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listPending(payload),
      ),
    acquireModel: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["acquireModel"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.acquireModel(payload),
      ),
    modelDoGenerate: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["modelDoGenerate"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.modelDoGenerate(payload),
      ),
    modelDoStream: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["modelDoStream"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.modelDoStream(payload),
        ),
      ),
    abortModelCall: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["abortModelCall"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.abortModelCall(payload),
      ),
    chatSendMessages: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["chatSendMessages"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.chatSendMessages(payload),
        ),
      ),
    chatReconnectStream: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["chatReconnectStream"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.chatReconnectStream(payload),
        ),
      ),
    abortChatStream: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["abortChatStream"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.abortChatStream(payload),
      ),
    listProviders: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["listProviders"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listProviders(payload),
      ),
    listConnectedModels: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["listConnectedModels"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listConnectedModels(payload),
      ),
    listPermissions: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["listPermissions"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listPermissions(payload),
      ),
    openProviderAuthWindow: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["openProviderAuthWindow"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.openProviderAuthWindow(payload),
      ),
    getProviderAuthFlow: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["getProviderAuthFlow"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.getProviderAuthFlow(payload),
      ),
    startProviderAuthFlow: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["startProviderAuthFlow"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.startProviderAuthFlow(payload),
      ),
    cancelProviderAuthFlow: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["cancelProviderAuthFlow"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.cancelProviderAuthFlow(payload),
      ),
    disconnectProvider: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["disconnectProvider"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.disconnectProvider(payload),
      ),
    createPermissionRequest: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["createPermissionRequest"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.createPermissionRequest(payload),
      ),
    setOriginEnabled: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["setOriginEnabled"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.setOriginEnabled(payload),
      ),
    setModelPermission: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["setModelPermission"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.setModelPermission(payload),
      ),
    resolvePermissionRequest: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["resolvePermissionRequest"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.resolvePermissionRequest(payload),
      ),
    dismissPermissionRequest: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["dismissPermissionRequest"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.dismissPermissionRequest(payload),
      ),
    streamProviders: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["streamProviders"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.streamProviders(payload),
        ),
      ),
    streamModels: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["streamModels"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.streamModels(payload),
        ),
      ),
    streamOriginState: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["streamOriginState"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.streamOriginState(payload),
        ),
      ),
    streamPermissions: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["streamPermissions"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.streamPermissions(payload),
        ),
      ),
    streamPending: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["streamPending"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.streamPending(payload),
        ),
      ),
    streamProviderAuthFlow: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeAdminRpc>["streamProviderAuthFlow"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.streamProviderAuthFlow(payload),
        ),
      ),
  };
}

export function getRuntimeAdminRPC() {
  return createRuntimeAdminRpcClient({
    ensureClient: core.ensureClient,
  });
}
