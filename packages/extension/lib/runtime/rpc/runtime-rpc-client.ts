import {
  RUNTIME_ADMIN_RPC_PORT_NAME,
  RuntimeValidationError,
  RuntimeAdminRpcGroup,
} from "@llm-bridge/contracts";
import { makeRuntimeRpcClientFactory } from "./runtime-rpc-client-factory";

const CONNECTION_INVALIDATED_MESSAGE =
  "Runtime connection was destroyed while connecting";

const getRuntimeAdminRpcClient = makeRuntimeRpcClientFactory({
  portName: RUNTIME_ADMIN_RPC_PORT_NAME,
  rpcGroup: RuntimeAdminRpcGroup,
  invalidatedError: () =>
    new RuntimeValidationError({
      message: CONNECTION_INVALIDATED_MESSAGE,
    }),
});

export function getRuntimeAdminRPC() {
  return getRuntimeAdminRpcClient();
}

// Backward compatibility for existing imports.
export const getRuntimeRPC = getRuntimeAdminRPC;
