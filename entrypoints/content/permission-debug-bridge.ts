import { browser } from "@wxt-dev/browser"
import { getRuntimeRPC } from "@/lib/runtime/rpc/runtime-rpc-client"

const DEBUG_SOURCE = "llm-bridge-debug"
const DEBUG_MESSAGE_TYPE = "trigger-permission-popup"
const DEBUG_SCRIPT_ID = "llm-bridge-debug-script"

let debugListenerAttached = false

type DebugPayload = {
  origin?: string
  provider?: string
  modelName?: string
  modelId?: string
  capabilities?: string[]
  count?: number
}

function injectPageConsoleApi() {
  const existingScript = document.getElementById(DEBUG_SCRIPT_ID)
  if (existingScript) return

  const script = document.createElement("script")
  script.id = DEBUG_SCRIPT_ID
  script.src = browser.runtime.getURL("/permission-debug-bridge.js")
  const mountTarget = document.head ?? document.documentElement
  mountTarget.append(script)
}

function normalizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1
  const next = Math.floor(value)
  if (next < 1) return 1
  if (next > 20) return 20
  return next
}

async function addDebugRequests(payload: DebugPayload) {
  const count = normalizeCount(payload.count)
  const origin = payload.origin ?? window.location.origin
  const baseModelId = payload.modelId ?? "openai/gpt-4o-mini"
  const fallbackProvider = payload.provider ?? baseModelId.split("/")[0]
  const fallbackModel = payload.modelName ?? baseModelId.split("/")[1]
  const runtime = getRuntimeRPC()

  for (let index = 0; index < count; index += 1) {
    await runtime.requestPermission({
      origin,
      provider: fallbackProvider,
      modelName: fallbackModel,
      modelId: baseModelId,
      capabilities: payload.capabilities,
    })
  }
}

function isDebugMessage(
  data: unknown,
): data is {
  source?: string
  type?: string
  payload?: DebugPayload
} {
  return !!data && typeof data === "object"
}

function onDebugMessage(event: MessageEvent<unknown>) {
  if (event.source !== window) return
  if (!isDebugMessage(event.data)) return
  if (event.data.source !== DEBUG_SOURCE || event.data.type !== DEBUG_MESSAGE_TYPE) return

  void addDebugRequests(event.data.payload ?? {})
}

export function setupPermissionDebugBridge() {
  injectPageConsoleApi()
  if (debugListenerAttached) return

  debugListenerAttached = true
  window.addEventListener("message", onDebugMessage)
}
