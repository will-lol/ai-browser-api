import { browser } from "@wxt-dev/browser";
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension";
import {
  RUNTIME_RPC_PORT_NAME,
  type RuntimeRPCService,
} from "@/lib/runtime/rpc/runtime-rpc-types";

type RuntimePort = ReturnType<typeof browser.runtime.connect>;

let runtimeRPC: RuntimeRPCService | null = null;
let runtimePort: RuntimePort | null = null;
let channel: RPCChannel<Record<string, never>, RuntimeRPCService> | null = null;

function resetRuntimeRPC() {
  runtimeRPC = null;
  runtimePort = null;
  channel = null;
}

export function getRuntimeRPC(): RuntimeRPCService {
  if (runtimeRPC) return runtimeRPC;

  const port = browser.runtime.connect({
    name: RUNTIME_RPC_PORT_NAME,
  });

  const io = new ChromePortIO(port);
  channel = new RPCChannel<Record<string, never>, RuntimeRPCService>(io, {
    expose: {},
  });

  port.onDisconnect.addListener(() => {
    if (runtimePort !== port) return;
    channel?.destroy();
    resetRuntimeRPC();
  });

  runtimeRPC = channel.getAPI();
  runtimePort = port;

  return runtimeRPC;
}

// Ensure clean disconnection on page unload/bfcache
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (runtimePort) {
      runtimePort.disconnect();
      channel?.destroy();
      resetRuntimeRPC();
    }
  });
}

