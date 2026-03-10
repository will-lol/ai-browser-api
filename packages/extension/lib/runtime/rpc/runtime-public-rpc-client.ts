import {
  type RuntimeRpc,
  RUNTIME_PUBLIC_RPC_PORT_NAME,
  RuntimeRpcGroup,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  makeRuntimeRpcClientCore,
  type RuntimeRpcClientConnection,
} from "./runtime-rpc-client-core";

const CONNECTION_INVALIDATED_MESSAGE =
  "Runtime connection was destroyed while connecting";

const core = makeRuntimeRpcClientCore({
  portName: RUNTIME_PUBLIC_RPC_PORT_NAME,
  rpcGroup: RuntimeRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: CONNECTION_INVALIDATED_MESSAGE,
    }),
});

export function createRuntimePublicRpcClient(input: {
  readonly ensureClient: Effect.Effect<
    RuntimeRpcClientConnection<RuntimeRpc>,
    RuntimeValidationError
  >;
}) {
  return {
    listModels: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["listModels"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.listModels(payload)),
    getOriginState: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["getOriginState"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.getOriginState(payload)),
    listPending: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["listPending"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.listPending(payload)),
    acquireModel: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["acquireModel"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.acquireModel(payload)),
    modelDoGenerate: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["modelDoGenerate"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.modelDoGenerate(payload)),
    modelDoStream: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["modelDoStream"]>[0]) =>
      Stream.unwrap(Effect.map(input.ensureClient, (client) => client.modelDoStream(payload))),
    abortModelCall: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["abortModelCall"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.abortModelCall(payload)),
    chatSendMessages: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["chatSendMessages"]>[0]) =>
      Stream.unwrap(Effect.map(input.ensureClient, (client) => client.chatSendMessages(payload))),
    chatReconnectStream: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["chatReconnectStream"]>[0]) =>
      Stream.unwrap(Effect.map(input.ensureClient, (client) => client.chatReconnectStream(payload))),
    abortChatStream: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["abortChatStream"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.abortChatStream(payload)),
    createPermissionRequest: (payload: Parameters<RuntimeRpcClientConnection<RuntimeRpc>["createPermissionRequest"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.createPermissionRequest(payload)),
  };
}

export function getRuntimePublicRPC() {
  return createRuntimePublicRpcClient({
    ensureClient: core.ensureClient,
  });
}
