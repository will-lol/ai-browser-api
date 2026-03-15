import {
  type RuntimeAdminRpc,
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeAdminRpcGroup,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import { makeRuntimeRpcClientCore } from "@/shared/rpc/runtime-rpc-client-core";
import {
  bindRuntimeRpcStreamMethodByKey,
  bindRuntimeRpcUnaryMethodByKey,
  RUNTIME_RPC_CONNECTION_INVALIDATED_MESSAGE,
  type StreamRpcTag,
  type UnaryRpcTag,
} from "@/shared/rpc/runtime-rpc-client-factory";

const core = makeRuntimeRpcClientCore({
  portName: RUNTIME_ADMIN_RPC_PORT_NAME,
  rpcGroup: RuntimeAdminRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: RUNTIME_RPC_CONNECTION_INVALIDATED_MESSAGE,
    }),
});

const bindUnary = <Key extends UnaryRpcTag<RuntimeAdminRpc>>(key: Key) =>
  bindRuntimeRpcUnaryMethodByKey<
    RuntimeAdminRpc,
    RuntimeValidationError,
    Key
  >(
    core.ensureClient,
    key,
  );

const bindStream = <Key extends StreamRpcTag<RuntimeAdminRpc>>(key: Key) =>
  bindRuntimeRpcStreamMethodByKey<
    RuntimeAdminRpc,
    RuntimeValidationError,
    Key
  >(
    core.ensureClient,
    key,
  );

export function getRuntimeAdminRPC() {
  return {
    listModels: bindUnary("listModels"),
    getOriginState: bindUnary("getOriginState"),
    listPending: bindUnary("listPending"),
    acquireModel: bindUnary("acquireModel"),
    modelDoGenerate: bindUnary("modelDoGenerate"),
    modelDoStream: bindStream("modelDoStream"),
    abortModelCall: bindUnary("abortModelCall"),
    chatSendMessages: bindStream("chatSendMessages"),
    chatReconnectStream: bindStream("chatReconnectStream"),
    abortChatStream: bindUnary("abortChatStream"),
    listProviders: bindUnary("listProviders"),
    listConnectedModels: bindUnary("listConnectedModels"),
    listPermissions: bindUnary("listPermissions"),
    openProviderAuthWindow: bindUnary("openProviderAuthWindow"),
    getProviderAuthFlow: bindUnary("getProviderAuthFlow"),
    startProviderAuthFlow: bindUnary("startProviderAuthFlow"),
    cancelProviderAuthFlow: bindUnary("cancelProviderAuthFlow"),
    disconnectProvider: bindUnary("disconnectProvider"),
    createPermissionRequest: bindUnary("createPermissionRequest"),
    setOriginEnabled: bindUnary("setOriginEnabled"),
    setModelPermission: bindUnary("setModelPermission"),
    resolvePermissionRequest: bindUnary("resolvePermissionRequest"),
    dismissPermissionRequest: bindUnary("dismissPermissionRequest"),
    streamProviders: bindStream("streamProviders"),
    streamModels: bindStream("streamModels"),
    streamOriginState: bindStream("streamOriginState"),
    streamPermissions: bindStream("streamPermissions"),
    streamPending: bindStream("streamPending"),
    streamProviderAuthFlow: bindStream("streamProviderAuthFlow"),
  };
}
