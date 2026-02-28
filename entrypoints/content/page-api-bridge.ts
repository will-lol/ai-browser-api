import { browser } from "@wxt-dev/browser"
import type { Browser } from "@wxt-dev/browser"

const PAGE_SOURCE = "llm-bridge-page"
const CONTENT_SOURCE = "llm-bridge-content"
const PAGE_API_SCRIPT_ID = "llm-bridge-page-api"
const STREAM_PORT = "llm-bridge-stream"

type BridgeMessage = {
  source?: string
  requestId?: string
  type?: string
  payload?: Record<string, unknown>
}

const streamPorts = new Map<string, Browser.runtime.Port>()

function injectPageApi() {
  if (document.getElementById(PAGE_API_SCRIPT_ID)) return

  const script = document.createElement("script")
  script.id = PAGE_API_SCRIPT_ID
  script.src = browser.runtime.getURL("llm-bridge-page-api.js")
  const mountTarget = document.head ?? document.documentElement
  mountTarget.append(script)
}

function sendToPage(requestId: string, type: "response" | "stream", payload: Record<string, unknown>, ok = true, error?: string) {
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

async function runtimeMessage(type: string, payload: Record<string, unknown>) {
  const response = await browser.runtime.sendMessage({
    type,
    payload,
  })

  if (!response?.ok) {
    throw new Error(response?.error ?? `Runtime request failed: ${type}`)
  }

  return response.data as unknown
}

async function handleRequest(message: BridgeMessage) {
  const requestId = message.requestId
  if (!requestId || !message.type) return

  try {
    const payload = message.payload ?? {}

    if (message.type === "get-state") {
      const currentOrigin = window.location.origin
      const [providersData, modelsData, permissionsData, pendingData, originData] = await Promise.all([
        runtimeMessage("runtime.providers.list", { origin: currentOrigin }),
        runtimeMessage("runtime.models.list", { origin: currentOrigin }),
        runtimeMessage("runtime.permissions.list", { origin: currentOrigin }),
        runtimeMessage("runtime.pending.list", { origin: currentOrigin }),
        runtimeMessage("runtime.origin.get", { origin: currentOrigin }),
      ])

      const providers = Array.isArray(providersData)
        ? providersData
        : []
      const models = Array.isArray(modelsData)
        ? modelsData
        : []

      const modelsByProvider = new Map<string, Array<Record<string, unknown>>>()
      for (const model of models) {
        if (!model || typeof model !== "object") continue
        const providerID = String(model.provider ?? "")
        if (!providerID) continue

        const row = {
          id: String(model.modelId ?? model.id ?? ""),
          name: String(model.modelName ?? model.name ?? ""),
          capabilities: Array.isArray(model.capabilities)
            ? model.capabilities
            : [],
        }

        const existing = modelsByProvider.get(providerID) ?? []
        existing.push(row)
        modelsByProvider.set(providerID, existing)
      }

      const normalizedProviders = providers
        .filter((provider): provider is Record<string, unknown> => !!provider && typeof provider === "object")
        .map((provider) => ({
          id: String(provider.id ?? ""),
          name: String(provider.name ?? ""),
          connected: Boolean(provider.connected),
          env: Array.isArray(provider.env) ? provider.env : [],
          authMethods: [],
          models: modelsByProvider.get(String(provider.id ?? "")) ?? [],
        }))

      sendToPage(requestId, "response", {
        providers: normalizedProviders,
        permissions: Array.isArray(permissionsData) ? permissionsData : [],
        pendingRequests: Array.isArray(pendingData) ? pendingData : [],
        originEnabled: Boolean((originData as { enabled?: unknown })?.enabled ?? true),
        currentOrigin,
      })
      return
    }

    if (message.type === "list-models") {
      const response = await runtimeMessage("runtime.models.list", {
        origin: window.location.origin,
      })

      const models = Array.isArray(response)
        ? response.map((model) => ({
            id: String((model as Record<string, unknown>).id ?? ""),
            name: String((model as Record<string, unknown>).name ?? ""),
            provider: String((model as Record<string, unknown>).provider ?? ""),
            capabilities: Array.isArray((model as Record<string, unknown>).capabilities)
              ? ((model as Record<string, unknown>).capabilities as string[])
              : [],
            connected: Boolean((model as Record<string, unknown>).connected),
          }))
        : []

      sendToPage(requestId, "response", {
        models,
      })
      return
    }

    if (message.type === "request-permission") {
      const response = await browser.runtime.sendMessage({
        type: "runtime.request-permission",
        payload: {
          origin: window.location.origin,
          modelId: payload.modelId,
          modelName: payload.modelName,
          provider: payload.provider,
          capabilities: payload.capabilities,
        },
      })
      if (!response?.ok) throw new Error(response?.error ?? "Failed to queue permission request")
      sendToPage(requestId, "response", response.data)
      return
    }

    if (message.type === "abort") {
      const streamId = payload.requestId as string
      const port = streamPorts.get(streamId)
      if (port) {
        port.postMessage({ type: "abort" })
        port.disconnect()
        streamPorts.delete(streamId)
      }

      await browser.runtime.sendMessage({
        type: "runtime.abort",
        payload: {
          requestId: streamId,
        },
      })
      sendToPage(requestId, "response", { ok: true })
      return
    }

    if (message.type === "invoke") {
      const model = payload.model as string
      const body = (payload.body as Record<string, unknown> | undefined) ?? payload
      const stream = payload.stream === true

      if (stream) {
        const port = browser.runtime.connect({
          name: STREAM_PORT,
        })

        streamPorts.set(requestId, port)

        port.onMessage.addListener((event) => {
          if (event.requestId !== requestId) return

          if (event.type === "chunk") {
            sendToPage(requestId, "stream", { type: "chunk", data: event.data })
            return
          }

          if (event.type === "done") {
            sendToPage(requestId, "stream", { type: "done" })
            port.disconnect()
            streamPorts.delete(requestId)
            return
          }

          if (event.type === "error") {
            sendToPage(requestId, "stream", { type: "done" }, false, event.error)
            port.disconnect()
            streamPorts.delete(requestId)
          }
        })

        port.onDisconnect.addListener(() => {
          streamPorts.delete(requestId)
        })

        port.postMessage({
          type: "invoke",
          requestId,
          origin: window.location.origin,
          sessionID: payload.sessionID ?? requestId,
          model,
          body,
        })

        sendToPage(requestId, "response", {
          requestId,
          stream: true,
        })
        return
      }

      const response = await browser.runtime.sendMessage({
        type: "runtime.invoke",
        payload: {
          origin: window.location.origin,
          requestId,
          sessionID: payload.sessionID ?? requestId,
          model,
          body,
        },
      })

      if (!response?.ok) {
        throw new Error(response?.error ?? "Invocation failed")
      }

      sendToPage(requestId, "response", response.data)
      return
    }

    sendToPage(requestId, "response", {}, false, `Unknown request type: ${message.type}`)
  } catch (error) {
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
