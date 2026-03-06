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
    unknown
  >;
}) {
  const withClient = <A, E>(
    f: (client: RuntimeRpcClientConnection<RuntimePublicRpc>) => Effect.Effect<A, E>,
  ) => Effect.flatMap(input.ensureClient, f);

  const withClientStream = <A, E>(
    f: (client: RuntimeRpcClientConnection<RuntimePublicRpc>) => Stream.Stream<A, E>,
  ) => Stream.unwrap(Effect.map(input.ensureClient, f));

  return {
    listModels: (payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["listModels"]>[0]) =>
      withClient((client) => client.listModels(payload)),
    getOriginState: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["getOriginState"]>[0],
    ) => withClient((client) => client.getOriginState(payload)),
    listPending: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["listPending"]>[0],
    ) => withClient((client) => client.listPending(payload)),
    acquireModel: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["acquireModel"]>[0],
    ) => withClient((client) => client.acquireModel(payload)),
    modelDoGenerate: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["modelDoGenerate"]>[0],
    ) => withClient((client) => client.modelDoGenerate(payload)),
    modelDoStream: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["modelDoStream"]>[0],
    ) => withClientStream((client) => client.modelDoStream(payload)),
    abortModelCall: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["abortModelCall"]>[0],
    ) => withClient((client) => client.abortModelCall(payload)),
    requestPermission: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimePublicRpc>["requestPermission"]>[0],
    ) => withClient((client) => client.requestPermission(payload)),
  };
}

export function getRuntimePublicRPC() {
  return createRuntimePublicRpcClient({
    ensureClient: core.ensureClient,
  });
}
