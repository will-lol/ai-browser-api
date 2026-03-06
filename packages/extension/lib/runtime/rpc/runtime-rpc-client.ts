import {
  type RuntimeAdminRpc,
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeValidationError,
  RuntimeAdminRpcGroup,
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
  portName: RUNTIME_ADMIN_RPC_PORT_NAME,
  rpcGroup: RuntimeAdminRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: CONNECTION_INVALIDATED_MESSAGE,
    }),
});

export function createRuntimeAdminRpcClient(input: {
  readonly ensureClient: Effect.Effect<
    RuntimeRpcClientConnection<RuntimeAdminRpc>,
    unknown
  >;
}) {
  const withClient = <A, E>(
    f: (client: RuntimeRpcClientConnection<RuntimeAdminRpc>) => Effect.Effect<A, E>,
  ) => Effect.flatMap(input.ensureClient, f);

  const withClientStream = <A, E>(
    f: (client: RuntimeRpcClientConnection<RuntimeAdminRpc>) => Stream.Stream<A, E>,
  ) => Stream.unwrap(Effect.map(input.ensureClient, f));

  return {
    listModels: (payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listModels"]>[0]) =>
      withClient((client) => client.listModels(payload)),
    getOriginState: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["getOriginState"]>[0],
    ) => withClient((client) => client.getOriginState(payload)),
    listPending: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listPending"]>[0],
    ) => withClient((client) => client.listPending(payload)),
    acquireModel: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["acquireModel"]>[0],
    ) => withClient((client) => client.acquireModel(payload)),
    modelDoGenerate: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["modelDoGenerate"]>[0],
    ) => withClient((client) => client.modelDoGenerate(payload)),
    modelDoStream: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["modelDoStream"]>[0],
    ) => withClientStream((client) => client.modelDoStream(payload)),
    abortModelCall: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["abortModelCall"]>[0],
    ) => withClient((client) => client.abortModelCall(payload)),
    listProviders: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listProviders"]>[0],
    ) => withClient((client) => client.listProviders(payload)),
    listConnectedModels: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listConnectedModels"]>[0],
    ) => withClient((client) => client.listConnectedModels(payload)),
    listPermissions: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["listPermissions"]>[0],
    ) => withClient((client) => client.listPermissions(payload)),
    openProviderAuthWindow: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["openProviderAuthWindow"]>[0],
    ) => withClient((client) => client.openProviderAuthWindow(payload)),
    getProviderAuthFlow: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["getProviderAuthFlow"]>[0],
    ) => withClient((client) => client.getProviderAuthFlow(payload)),
    startProviderAuthFlow: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["startProviderAuthFlow"]>[0],
    ) => withClient((client) => client.startProviderAuthFlow(payload)),
    cancelProviderAuthFlow: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["cancelProviderAuthFlow"]>[0],
    ) => withClient((client) => client.cancelProviderAuthFlow(payload)),
    disconnectProvider: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["disconnectProvider"]>[0],
    ) => withClient((client) => client.disconnectProvider(payload)),
    updatePermission: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["updatePermission"]>[0],
    ) => withClient((client) => client.updatePermission(payload)),
    requestPermission: (
      payload: Parameters<RuntimeRpcClientConnection<RuntimeAdminRpc>["requestPermission"]>[0],
    ) => withClient((client) => client.requestPermission(payload)),
  };
}

export function getRuntimeAdminRPC() {
  return createRuntimeAdminRpcClient({
    ensureClient: core.ensureClient,
  });
}

// Backward compatibility for existing imports.
export const getRuntimeRPC = getRuntimeAdminRPC;
