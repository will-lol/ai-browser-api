import {
  type RuntimePublicRpc,
  RUNTIME_PUBLIC_RPC_PORT_NAME,
  RuntimePublicRpcGroup,
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
  portName: RUNTIME_PUBLIC_RPC_PORT_NAME,
  rpcGroup: RuntimePublicRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: CONNECTION_INVALIDATED_MESSAGE,
    }),
});

function createRuntimePublicRpcClient(input: {
  readonly ensureClient: Effect.Effect<
    RuntimeRpcClientConnection<RuntimePublicRpc>,
    RuntimeValidationError
  >;
}) {
  return {
    listModels: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["listModels"]>[0]) =>
      client.listModels(payload)),
    getOriginState: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["getOriginState"]>[0]) =>
      client.getOriginState(payload)),
    listPending: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["listPending"]>[0]) =>
      client.listPending(payload)),
    acquireModel: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["acquireModel"]>[0]) =>
      client.acquireModel(payload)),
    modelDoGenerate: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["modelDoGenerate"]>[0]) =>
      client.modelDoGenerate(payload)),
    modelDoStream: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["modelDoStream"]>[0]) =>
      client.modelDoStream(payload)),
    abortModelCall: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["abortModelCall"]>[0]) =>
      client.abortModelCall(payload)),
    chatSendMessages: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["chatSendMessages"]>[0]) =>
      client.chatSendMessages(payload)),
    chatReconnectStream: bindRuntimeRpcStreamMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["chatReconnectStream"]>[0]) =>
      client.chatReconnectStream(payload)),
    abortChatStream: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["abortChatStream"]>[0]) =>
      client.abortChatStream(payload)),
    createPermissionRequest: bindRuntimeRpcUnaryMethod(input.ensureClient, (client) => (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["createPermissionRequest"]>[0]) =>
      client.createPermissionRequest(payload)),
  };
}

export function getRuntimePublicRPC() {
  return createRuntimePublicRpcClient({
    ensureClient: core.ensureClient,
  });
}
