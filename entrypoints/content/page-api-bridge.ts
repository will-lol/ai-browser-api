import { browser } from "@wxt-dev/browser"
import { getRuntimeRPC } from "@/lib/runtime/rpc/runtime-rpc-client"

const PAGE_SOURCE = "llm-bridge-page"
const CONTENT_SOURCE = "llm-bridge-content"
const PAGE_API_SCRIPT_ID = "llm-bridge-page-api"

type BridgeMessage = {
  source?: string
  requestId?: string
  type?: string
  payload?: Record<string, unknown>
}

const activeStreamIterators = new Map<string, AsyncIterator<string>>()

function injectPageApi() {
  if (document.getElementById(PAGE_API_SCRIPT_ID)) return

  const script = document.createElement("script")
  script.id = PAGE_API_SCRIPT_ID
  script.src = browser.runtime.getURL("llm-bridge-page-api.js")
  const mountTarget = document.head ?? document.documentElement
  mountTarget.append(script)
}

function sendToPage(
  requestId: string,
  type: "response" | "stream",
  payload: unknown,
  ok = true,
  error?: string,
) {
  window.postMessage(
    {
      source: CONTENT_SOURCE,
      requestId,
      type,
      ok,
      payload,
      error,
    },
    "*",
  )
}

function isBridgeMessage(data: unknown): data is BridgeMessage {
  return !!data && typeof data === "object"
}

async function pumpStreamToPage(requestId: string, iterator: AsyncIterator<string>) {
  try {
    while (true) {
      const chunk = await iterator.next()
      if (chunk.done) {
        sendToPage(requestId, "stream", { type: "done" })
        return
      }

      sendToPage(requestId, "stream", {
        type: "chunk",
        data: chunk.value ?? "",
      })
    }
  } catch (error) {
    if (!activeStreamIterators.has(requestId)) {
      sendToPage(requestId, "stream", { type: "done" })
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    sendToPage(requestId, "stream", { type: "done" }, false, message)
  } finally {
    activeStreamIterators.delete(requestId)
  }
}

async function handleRequest(message: BridgeMessage) {
  const requestId = message.requestId
  if (!requestId || !message.type) return

  try {
    const payload = message.payload ?? {}
    const runtime = getRuntimeRPC()

    if (message.type === "get-state") {
      const currentOrigin = window.location.origin
      const [providersData, modelsData, permissionsData, pendingData, originData] = await Promise.all([
        runtime.listProviders({ origin: currentOrigin }),
        runtime.listModels({ origin: currentOrigin }),
        runtime.listPermissions({ origin: currentOrigin }),
        runtime.listPending({ origin: currentOrigin }),
        runtime.getOriginState({ origin: currentOrigin }),
      ])

      const modelsByProvider = new Map<string, Array<Record<string, unknown>>>()
      for (const model of modelsData) {
        const providerID = model.provider
        if (!providerID) continue

        const row = {
          id: model.modelId || model.id,
          name: model.modelName || model.name,
          capabilities: model.capabilities,
        }

        const existing = modelsByProvider.get(providerID) ?? []
        existing.push(row)
        modelsByProvider.set(providerID, existing)
      }

      const normalizedProviders = providersData.map((provider) => ({
        id: provider.id,
        name: provider.name,
        connected: provider.connected,
        env: provider.env,
        authMethods: [],
        models: modelsByProvider.get(provider.id) ?? [],
      }))

      sendToPage(requestId, "response", {
        providers: normalizedProviders,
        permissions: permissionsData,
        pendingRequests: pendingData,
        originEnabled: originData.enabled,
        currentOrigin,
      })
      return
    }

    if (message.type === "list-models") {
      const response = await runtime.listModels({
        origin: window.location.origin,
      })

      const models = response.map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        capabilities: model.capabilities,
        connected: model.connected,
      }))

      sendToPage(requestId, "response", {
        models,
      })
      return
    }

    if (message.type === "request-permission") {
      const modelId = typeof payload.modelId === "string"
        ? payload.modelId
        : undefined
      const modelName = typeof payload.modelName === "string"
        ? payload.modelName
        : undefined
      const provider = typeof payload.provider === "string"
        ? payload.provider
        : undefined
      const capabilities = Array.isArray(payload.capabilities)
        ? payload.capabilities.filter((item): item is string => typeof item === "string")
        : undefined

      const response = await runtime.requestPermission({
        origin: window.location.origin,
        modelId,
        modelName,
        provider,
        capabilities,
      })
      sendToPage(requestId, "response", response)
      return
    }

    if (message.type === "abort") {
      const streamId = typeof payload.requestId === "string"
        ? payload.requestId
        : undefined

      if (streamId) {
        const iterator = activeStreamIterators.get(streamId)
        activeStreamIterators.delete(streamId)

        try {
          await iterator?.return?.()
        } catch {
          // Ignore iterator return errors during cancellation.
        }

        await runtime.abort({
          requestId: streamId,
        })
      }

      sendToPage(requestId, "response", { ok: true })
      return
    }

    if (message.type === "invoke") {
      const model = typeof payload.model === "string" ? payload.model : ""
      if (!model) {
        throw new Error("Model is required for invoke")
      }

      const sessionID = typeof payload.sessionID === "string"
        ? payload.sessionID
        : requestId
      const body = (payload.body as Record<string, unknown> | undefined) ?? payload
      const stream = payload.stream === true

      if (stream) {
        const iterable = await runtime.invokeStream({
          origin: window.location.origin,
          requestId,
          sessionID,
          model,
          body,
        })

        const iterator = iterable[Symbol.asyncIterator]()
        activeStreamIterators.set(requestId, iterator)
        void pumpStreamToPage(requestId, iterator)

        sendToPage(requestId, "response", {
          requestId,
          stream: true,
        })
        return
      }

      const response = await runtime.invoke({
        origin: window.location.origin,
        requestId,
        sessionID,
        model,
        body,
      })

      sendToPage(requestId, "response", response)
      return
    }

    sendToPage(requestId, "response", {}, false, `Unknown request type: ${message.type}`)
  } catch (error) {
    activeStreamIterators.delete(requestId)
    const messageText = error instanceof Error ? error.message : String(error)
    sendToPage(requestId, "response", {}, false, messageText)
  }
}

function onPageMessage(event: MessageEvent<unknown>) {
  if (event.source !== window) return
  if (!isBridgeMessage(event.data)) return
  if (event.data.source !== PAGE_SOURCE) return

  void handleRequest(event.data)
}

export function setupPageApiBridge() {
  injectPageApi()
  window.addEventListener("message", onPageMessage)
}
