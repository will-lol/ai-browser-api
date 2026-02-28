import { browser } from "@wxt-dev/browser"
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"
import {
  RUNTIME_RPC_PORT_NAME,
  type RuntimeRPCService,
} from "@/lib/runtime/rpc/runtime-rpc-types"

type ChromeRuntimePort = ConstructorParameters<typeof ChromePortIO>[0]
type RuntimePort = ReturnType<typeof browser.runtime.connect>

let runtimeRPC: RuntimeRPCService | null = null
let runtimePort: RuntimePort | null = null

function resetRuntimeRPC() {
  runtimeRPC = null
  runtimePort = null
}

export function getRuntimeRPC(): RuntimeRPCService {
  if (runtimeRPC) return runtimeRPC

  const port = browser.runtime.connect({
    name: RUNTIME_RPC_PORT_NAME,
  })

  const io = new ChromePortIO(port as unknown as ChromeRuntimePort)
  const channel = new RPCChannel<Record<string, never>, RuntimeRPCService>(io, {
    expose: {},
  })

  port.onDisconnect.addListener(() => {
    if (runtimePort !== port) return
    channel.destroy()
    resetRuntimeRPC()
  })

  runtimeRPC = channel.getAPI()
  runtimePort = port

  return runtimeRPC
}
