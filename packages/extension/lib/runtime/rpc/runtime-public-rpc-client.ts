import {
  RUNTIME_PUBLIC_RPC_PORT_NAME,
  RuntimeValidationError,
  RuntimePublicRpcGroup,
} from "@llm-bridge/contracts"
import { makeRuntimeRpcClientFactory } from "./runtime-rpc-client-factory"

const CONNECTION_INVALIDATED_MESSAGE =
  "Runtime connection was destroyed while connecting"

const getRuntimePublicRpcClient = makeRuntimeRpcClientFactory({
  portName: RUNTIME_PUBLIC_RPC_PORT_NAME,
  rpcGroup: RuntimePublicRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: CONNECTION_INVALIDATED_MESSAGE,
    }),
})

export function getRuntimePublicRPC() {
  return getRuntimePublicRpcClient()
}
