import {
  type RuntimePublicRpc,
  RUNTIME_PUBLIC_RPC_PORT_NAME,
  RuntimeValidationError,
  RuntimePublicRpcGroup,
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
  rpcGroup: RuntimePublicRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: CONNECTION_INVALIDATED_MESSAGE,
    }),
});

export function createRuntimePublicRpcClient(input: {
  readonly ensureClient: Effect.Effect<
    RuntimeRpcClientConnection<RuntimePublicRpc>,
    RuntimeValidationError
  >;
}) {
  return {
    listModels: (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["listModels"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.listModels(payload)),
    getOriginState: (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["getOriginState"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.getOriginState(payload)),
    listPending: (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["listPending"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.listPending(payload)),
    acquireModel: (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["acquireModel"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.acquireModel(payload)),
    modelDoGenerate: (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["modelDoGenerate"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.modelDoGenerate(payload)),
    modelDoStream: (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["modelDoStream"]>[0]) =>
      Stream.unwrap(Effect.map(input.ensureClient, (client) => client.modelDoStream(payload))),
    abortModelCall: (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["abortModelCall"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.abortModelCall(payload)),
    requestPermission: (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["requestPermission"]>[0]) =>
      Effect.flatMap(input.ensureClient, (client) => client.requestPermission(payload)),
  };
}

export type RuntimePublicRpcClient = ReturnType<typeof createRuntimePublicRpcClient>;

export function getRuntimePublicRPC() {
  return createRuntimePublicRpcClient({
    ensureClient: core.ensureClient,
  });
}
