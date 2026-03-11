import {
  type RuntimeRpc,
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeRpcGroup,
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
  rpcGroup: RuntimeRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: CONNECTION_INVALIDATED_MESSAGE,
    }),
});

function createRuntimeAdminRpcClient(input: {
  readonly ensureClient: Effect.Effect<
    RuntimeRpcClientConnection<RuntimeRpc>,
    RuntimeValidationError
  >;
}) {
  return {
    listModels: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["listModels"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listModels(payload),
      ),
    getOriginState: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["getOriginState"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.getOriginState(payload),
      ),
    listPending: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["listPending"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listPending(payload),
      ),
    acquireModel: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["acquireModel"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.acquireModel(payload),
      ),
    modelDoGenerate: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["modelDoGenerate"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.modelDoGenerate(payload),
      ),
    modelDoStream: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["modelDoStream"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.modelDoStream(payload),
        ),
      ),
    abortModelCall: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["abortModelCall"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.abortModelCall(payload),
      ),
    chatSendMessages: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["chatSendMessages"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.chatSendMessages(payload),
        ),
      ),
    chatReconnectStream: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["chatReconnectStream"]
      >[0],
    ) =>
      Stream.unwrap(
        Effect.map(input.ensureClient, (client) =>
          client.chatReconnectStream(payload),
        ),
      ),
    abortChatStream: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["abortChatStream"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.abortChatStream(payload),
      ),
    listProviders: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["listProviders"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listProviders(payload),
      ),
    listConnectedModels: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["listConnectedModels"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listConnectedModels(payload),
      ),
    listPermissions: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["listPermissions"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.listPermissions(payload),
      ),
    openProviderAuthWindow: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["openProviderAuthWindow"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.openProviderAuthWindow(payload),
      ),
    getProviderAuthFlow: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["getProviderAuthFlow"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.getProviderAuthFlow(payload),
      ),
    startProviderAuthFlow: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["startProviderAuthFlow"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.startProviderAuthFlow(payload),
      ),
    cancelProviderAuthFlow: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["cancelProviderAuthFlow"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.cancelProviderAuthFlow(payload),
      ),
    disconnectProvider: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["disconnectProvider"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.disconnectProvider(payload),
      ),
    createPermissionRequest: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["createPermissionRequest"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.createPermissionRequest(payload),
      ),
    setOriginEnabled: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["setOriginEnabled"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.setOriginEnabled(payload),
      ),
    setModelPermission: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["setModelPermission"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.setModelPermission(payload),
      ),
    resolvePermissionRequest: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["resolvePermissionRequest"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.resolvePermissionRequest(payload),
      ),
    dismissPermissionRequest: (
      payload: Parameters<
        RuntimeRpcClientConnection<RuntimeRpc>["dismissPermissionRequest"]
      >[0],
    ) =>
      Effect.flatMap(input.ensureClient, (client) =>
        client.dismissPermissionRequest(payload),
      ),
  };
}

export function getRuntimeAdminRPC() {
  return createRuntimeAdminRpcClient({
    ensureClient: core.ensureClient,
  });
}
