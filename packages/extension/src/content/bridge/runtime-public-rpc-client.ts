import {
  type RuntimePublicRpc,
  RUNTIME_PUBLIC_RPC_PORT_NAME,
  RuntimePublicRpcGroup,
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
  portName: RUNTIME_PUBLIC_RPC_PORT_NAME,
  rpcGroup: RuntimePublicRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: RUNTIME_RPC_CONNECTION_INVALIDATED_MESSAGE,
    }),
});

const bindUnary = <Key extends UnaryRpcTag<RuntimePublicRpc>>(key: Key) =>
  bindRuntimeRpcUnaryMethodByKey<
    RuntimePublicRpc,
    RuntimeValidationError,
    Key
  >(
    core.ensureClient,
    key,
  );

const bindStream = <Key extends StreamRpcTag<RuntimePublicRpc>>(key: Key) =>
  bindRuntimeRpcStreamMethodByKey<
    RuntimePublicRpc,
    RuntimeValidationError,
    Key
  >(
    core.ensureClient,
    key,
  );

export function getRuntimePublicRPC() {
  return {
    listModels: bindUnary("listModels"),
    streamModels: bindStream("streamModels"),
    getOriginState: bindUnary("getOriginState"),
    listPending: bindUnary("listPending"),
    acquireModel: bindUnary("acquireModel"),
    modelDoGenerate: bindUnary("modelDoGenerate"),
    modelDoStream: bindStream("modelDoStream"),
    abortModelCall: bindUnary("abortModelCall"),
    chatSendMessages: bindStream("chatSendMessages"),
    chatReconnectStream: bindStream("chatReconnectStream"),
    abortChatStream: bindUnary("abortChatStream"),
    createPermissionRequest: bindUnary("createPermissionRequest"),
  };
}
