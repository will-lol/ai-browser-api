import type { BridgeClient, BridgeStreamHandle } from "@/lib/runtime/bridge/sdk-provider"

type BridgeGlobal = {
  listModels(): Promise<{ models: Array<{ id: string; name: string; provider: string; capabilities: string[]; connected: boolean }> }>
  requestPermission(input: { modelId: string; provider?: string; modelName?: string; capabilities?: string[] }): Promise<unknown>
  invoke(input: Record<string, unknown>): Promise<unknown | BridgeStreamHandle>
  abort(requestId: string): void
}

function getBridgeGlobal(): BridgeGlobal {
  const bridge = (globalThis as { llmBridge?: BridgeGlobal }).llmBridge
  if (!bridge) throw new Error("window.llmBridge is not available")
  return bridge as BridgeGlobal
}

export function createPageBridgeClient(): BridgeClient {
  return {
    listModels() {
      return getBridgeGlobal().listModels()
    },
    requestPermission(input) {
      return getBridgeGlobal().requestPermission(input)
    },
    invoke(input) {
      return getBridgeGlobal().invoke(input)
    },
    abort(requestId) {
      getBridgeGlobal().abort(requestId)
    },
  }
}
