import {
  type RuntimeAdminRpc,
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeAdminRpcGroup,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import {
  makeRuntimeRpcClientCore,
  type RuntimeRpcClientConnection,
} from "@/shared/rpc/runtime-rpc-client-core";
import {
  bindRuntimeRpcStreamMethod,
  bindRuntimeRpcUnaryMethod,
} from "@/shared/rpc/runtime-rpc-client-facade";

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
    listModels: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listModels"]>[0]) =>
      client.listModels(payload)),
    getOriginState: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["getOriginState"]>[0]) =>
      client.getOriginState(payload)),
    listPending: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listPending"]>[0]) =>
      client.listPending(payload)),
    acquireModel: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["acquireModel"]>[0]) =>
      client.acquireModel(payload)),
    modelDoGenerate: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["modelDoGenerate"]>[0]) =>
      client.modelDoGenerate(payload)),
    modelDoStream: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["modelDoStream"]>[0]) =>
      client.modelDoStream(payload)),
    abortModelCall: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["abortModelCall"]>[0]) =>
      client.abortModelCall(payload)),
    chatSendMessages: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["chatSendMessages"]>[0]) =>
      client.chatSendMessages(payload)),
    chatReconnectStream: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["chatReconnectStream"]>[0]) =>
      client.chatReconnectStream(payload)),
    abortChatStream: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["abortChatStream"]>[0]) =>
      client.abortChatStream(payload)),
    listProviders: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listProviders"]>[0]) =>
      client.listProviders(payload)),
    listConnectedModels: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listConnectedModels"]>[0]) =>
      client.listConnectedModels(payload)),
    listPermissions: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listPermissions"]>[0]) =>
      client.listPermissions(payload)),
    openProviderAuthWindow: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["openProviderAuthWindow"]>[0]) =>
      client.openProviderAuthWindow(payload)),
    getProviderAuthFlow: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["getProviderAuthFlow"]>[0]) =>
      client.getProviderAuthFlow(payload)),
    startProviderAuthFlow: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["startProviderAuthFlow"]>[0]) =>
      client.startProviderAuthFlow(payload)),
    cancelProviderAuthFlow: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["cancelProviderAuthFlow"]>[0]) =>
      client.cancelProviderAuthFlow(payload)),
    disconnectProvider: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["disconnectProvider"]>[0]) =>
      client.disconnectProvider(payload)),
    createPermissionRequest: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["createPermissionRequest"]>[0]) =>
      client.createPermissionRequest(payload)),
    setOriginEnabled: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["setOriginEnabled"]>[0]) =>
      client.setOriginEnabled(payload)),
    setModelPermission: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["setModelPermission"]>[0]) =>
      client.setModelPermission(payload)),
    resolvePermissionRequest: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["resolvePermissionRequest"]>[0]) =>
      client.resolvePermissionRequest(payload)),
    dismissPermissionRequest: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["dismissPermissionRequest"]>[0]) =>
      client.dismissPermissionRequest(payload)),
    streamProviders: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["streamProviders"]>[0]) =>
      client.streamProviders(payload)),
    streamModels: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["streamModels"]>[0]) =>
      client.streamModels(payload)),
    streamOriginState: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["streamOriginState"]>[0]) =>
      client.streamOriginState(payload)),
    streamPermissions: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["streamPermissions"]>[0]) =>
      client.streamPermissions(payload)),
    streamPending: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["streamPending"]>[0]) =>
      client.streamPending(payload)),
    streamProviderAuthFlow: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["streamProviderAuthFlow"]>[0]) =>
      client.streamProviderAuthFlow(payload)),
  };
}

export function getRuntimeAdminRPC() {
  return createRuntimeAdminRpcClient({
    ensureClient: core.ensureClient,
  });
}
