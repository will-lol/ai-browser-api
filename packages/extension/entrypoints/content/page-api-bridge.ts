import { IframeParentIO, RPCChannel, type IoInterface } from "kkrpc/browser"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { getRuntimeRPC } from "@/lib/runtime/rpc/runtime-rpc-client"
import type { RuntimeModelCallInput } from "@/lib/runtime/rpc/runtime-rpc-types"
import type {
  BridgeModelCallRequest,
  BridgeModelDescriptorResponse,
  PageBridgeService,
} from "@/lib/bridge/page-rpc-types"

const BRIDGE_TIMEOUT_MS = 30_000

const activeStreamIterators = new Map<string, AsyncIterator<LanguageModelV3StreamPart>>()

let bridgeChannel: RPCChannel<PageBridgeService, Record<string, never>, IoInterface> | null = null

function nextBridgeRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeModelCallInput(input: BridgeModelCallRequest) {
  const requestId = typeof input.requestId === "string" && input.requestId.length > 0
    ? input.requestId
    : nextBridgeRequestId()

  const sessionID = typeof input.sessionID === "string" && input.sessionID.length > 0
    ? input.sessionID
    : requestId

  const modelId = typeof input.modelId === "string" ? input.modelId : ""

  const options = (input.options as RuntimeModelCallInput["options"] | undefined) ?? {
    prompt: [],
  }

  return {
    requestId,
    sessionID,
    modelId,
    options,
  }
}

function serializeSupportedUrls(
  input: Record<string, RegExp[]> | undefined,
): BridgeModelDescriptorResponse["supportedUrls"] {
  const output: BridgeModelDescriptorResponse["supportedUrls"] = {}
  if (!input) return output

  for (const [mediaType, patterns] of Object.entries(input)) {
    if (!Array.isArray(patterns)) continue
    output[mediaType] = patterns
      .filter((pattern): pattern is RegExp => pattern instanceof RegExp)
      .map((pattern) => ({
        source: pattern.source,
        flags: pattern.flags,
      }))
  }

  return output
}

function createPageBridgeService(): PageBridgeService {
  return {
    async getState() {
      const runtime = getRuntimeRPC()
      const currentOrigin = window.location.origin

      const [providersData, modelsData, permissionsData, pendingData, originData] = await Promise.all([
        runtime.listProviders({ origin: currentOrigin }),
        runtime.listModels({ origin: currentOrigin }),
        runtime.listPermissions({ origin: currentOrigin }),
        runtime.listPending({ origin: currentOrigin }),
        runtime.getOriginState({ origin: currentOrigin }),
      ])

      const modelsByProvider = new Map<string, Array<{ id: string; name: string; capabilities?: unknown }>>()

      for (const model of modelsData) {
        const providerID = model.provider
        if (!providerID) continue

        const row = {
          id: model.id,
          name: model.name,
          capabilities: model.capabilities,
        }

        const existing = modelsByProvider.get(providerID) ?? []
        existing.push(row)
        modelsByProvider.set(providerID, existing)
      }

      return {
        providers: providersData.map((provider) => ({
          id: provider.id,
          name: provider.name,
          connected: provider.connected,
          env: provider.env,
          authMethods: [],
          models: modelsByProvider.get(provider.id) ?? [],
        })),
        permissions: permissionsData,
        pendingRequests: pendingData,
        originEnabled: originData.enabled,
        currentOrigin,
      }
    },

    async listModels() {
      const runtime = getRuntimeRPC()
      const models = await runtime.listModels({
        origin: window.location.origin,
        connectedOnly: true,
      })

      return {
        models,
      }
    },

    async getModel(input) {
      const runtime = getRuntimeRPC()
      const modelId = typeof input.modelId === "string" ? input.modelId : ""
      if (!modelId) {
        throw new Error("Model is required for getModel")
      }

      const requestId = typeof input.requestId === "string" && input.requestId.length > 0
        ? input.requestId
        : nextBridgeRequestId()

      const sessionID = typeof input.sessionID === "string" && input.sessionID.length > 0
        ? input.sessionID
        : requestId

      const descriptor = await runtime.acquireModel({
        origin: window.location.origin,
        requestId,
        sessionID,
        modelId,
      })

      return {
        specificationVersion: "v3",
        provider: descriptor.provider,
        modelId: descriptor.modelId,
        supportedUrls: serializeSupportedUrls(descriptor.supportedUrls),
      }
    },

    async requestPermission(input) {
      const runtime = getRuntimeRPC()
      return runtime.requestPermission({
        origin: window.location.origin,
        modelId: typeof input.modelId === "string" ? input.modelId : undefined,
        modelName: typeof input.modelName === "string" ? input.modelName : undefined,
        provider: typeof input.provider === "string" ? input.provider : undefined,
        capabilities: Array.isArray(input.capabilities)
          ? input.capabilities.filter((item): item is string => typeof item === "string")
          : undefined,
      })
    },

    async abort(input) {
      const runtime = getRuntimeRPC()
      const requestId = typeof input.requestId === "string" ? input.requestId : undefined
      if (!requestId) {
        return { ok: true }
      }

      const iterator = activeStreamIterators.get(requestId)
      activeStreamIterators.delete(requestId)

      try {
        await iterator?.return?.()
      } catch {
        // Ignore iterator return errors during cancellation.
      }

      await runtime.abortModelCall({
        requestId,
      })

      return { ok: true }
    },

    async modelDoGenerate(input) {
      const runtime = getRuntimeRPC()
      const normalized = normalizeModelCallInput(input)

      if (!normalized.modelId) {
        throw new Error("Model is required for modelDoGenerate")
      }

      return runtime.modelDoGenerate({
        origin: window.location.origin,
        requestId: normalized.requestId,
        sessionID: normalized.sessionID,
        modelId: normalized.modelId,
        options: normalized.options,
      })
    },

    modelDoStream(input) {
      const runtime = getRuntimeRPC()
      const normalized = normalizeModelCallInput(input)

      if (!normalized.modelId) {
        throw new Error("Model is required for modelDoStream")
      }

      return (async function* stream() {
        const iterable = await runtime.modelDoStream({
          origin: window.location.origin,
          requestId: normalized.requestId,
          sessionID: normalized.sessionID,
          modelId: normalized.modelId,
          options: normalized.options,
        })

        const iterator = iterable[Symbol.asyncIterator]()
        activeStreamIterators.set(normalized.requestId, iterator)

        try {
          while (true) {
            const chunk = await iterator.next()
            if (chunk.done) return
            yield chunk.value
          }
        } finally {
          activeStreamIterators.delete(normalized.requestId)
        }
      })()
    },
  }
}

export function setupPageApiBridge() {
  if (bridgeChannel) return

  const io = new IframeParentIO(window)
  bridgeChannel = new RPCChannel<PageBridgeService, Record<string, never>, IoInterface>(io, {
    expose: createPageBridgeService(),
    timeout: BRIDGE_TIMEOUT_MS,
  })
}
