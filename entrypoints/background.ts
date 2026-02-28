import { browser } from "@wxt-dev/browser"
import type { Browser } from "@wxt-dev/browser"
import { defineBackground } from "wxt/utils/define-background"
import { MODELS_REFRESH_INTERVAL_MS } from "@/lib/runtime/constants"
import { getModelsDevUpdatedAt, refreshModelsDevData } from "@/lib/runtime/models-dev"
import { invokeRuntimeModel } from "@/lib/runtime/service"
import {
  connectRuntimeProvider,
  createRuntimePermissionRequest,
  disconnectRuntimeProvider,
  dismissRuntimePermissionRequest,
  resolveRuntimePermissionRequest,
  setRuntimeOriginEnabled,
  updateRuntimePermission,
} from "@/lib/runtime/mutation-service"
import {
  getOriginState,
  listModels,
  listPendingRequestsForOrigin,
  listPermissionsForOrigin,
  listProviderAuthMethods,
  listProviders,
} from "@/lib/runtime/query-service"
import { refreshCatalog } from "@/lib/runtime/catalog-service"
import { ensureProviderCatalog } from "@/lib/runtime/provider-registry"
import { runtimeDb } from "@/lib/runtime/db/runtime-db"
import { subscribeRuntimeEvents } from "@/lib/runtime/events/runtime-events"
import { parseProviderModel } from "@/lib/runtime/util"
import type { BackgroundRpcMessage } from "@/lib/runtime/types"

const BADGE_BG = "#d97706"
const SOURCE_ICON_PATH = "/icon-dark-32x32.png"
const ICON_SIZES = [16, 32] as const
const STREAM_PORT = "llm-bridge-stream"
const MODELS_REFRESH_ALARM = "models-dev-refresh"

const ACTIVE_ICON_COLORS = {
  dark: { r: 20, g: 83, b: 45 },
  light: { r: 134, g: 239, b: 172 },
}

const INACTIVE_ICON_COLORS = {
  dark: { r: 71, g: 85, b: 105 },
  light: { r: 203, g: 213, b: 225 },
}

type Rgb = { r: number; g: number; b: number }
type IconState = "active" | "inactive"

let sourceIconPromise: Promise<ImageData> | null = null
const iconImageCache: Partial<Record<IconState, Record<number, ImageData>>> = {}

const streamControllers = new Map<string, AbortController>()
let modelsRefreshInFlight: Promise<void> | null = null

async function refreshModelsSnapshot() {
  try {
    const updatedAt = await getModelsDevUpdatedAt()
    if (updatedAt > 0 && Date.now() - updatedAt < MODELS_REFRESH_INTERVAL_MS) {
      return
    }

    await refreshModelsDevData()
    await refreshCatalog()
  } catch (error) {
    console.warn("models.dev refresh failed", error)
  }
}

function refreshModelsSnapshotOnce() {
  if (modelsRefreshInFlight) return modelsRefreshInFlight

  modelsRefreshInFlight = refreshModelsSnapshot().finally(() => {
    modelsRefreshInFlight = null
  })

  return modelsRefreshInFlight
}

async function scheduleModelsRefreshAlarm() {
  if (!browser.alarms?.create) return

  const periodInMinutes = Math.max(1, Math.floor(MODELS_REFRESH_INTERVAL_MS / 60_000))
  await browser.alarms.create(MODELS_REFRESH_ALARM, {
    periodInMinutes,
  })
}

async function getSourceIconData(): Promise<ImageData> {
  if (sourceIconPromise) return sourceIconPromise

  sourceIconPromise = (async () => {
    const response = await fetch(browser.runtime.getURL(SOURCE_ICON_PATH))
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Failed to initialize icon drawing context")

    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height)
  })()

  return sourceIconPromise
}

function tintImageData(source: ImageData, dark: Rgb, light: Rgb, size: number): ImageData {
  const sourceCanvas = new OffscreenCanvas(source.width, source.height)
  const sourceContext = sourceCanvas.getContext("2d")
  if (!sourceContext) throw new Error("Failed to initialize source icon context")

  sourceContext.putImageData(source, 0, 0)

  const canvas = new OffscreenCanvas(size, size)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Failed to initialize tinted icon context")

  context.drawImage(sourceCanvas, 0, 0, size, size)

  const output = context.getImageData(0, 0, size, size)
  const data = output.data

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha === 0) continue

    const luminance = (data[i] + data[i + 1] + data[i + 2]) / (255 * 3)
    data[i] = Math.round(dark.r + (light.r - dark.r) * luminance)
    data[i + 1] = Math.round(dark.g + (light.g - dark.g) * luminance)
    data[i + 2] = Math.round(dark.b + (light.b - dark.b) * luminance)
  }

  return output
}

async function getIconImageData(iconState: IconState): Promise<Record<number, ImageData>> {
  const cached = iconImageCache[iconState]
  if (cached) return cached

  const sourceIcon = await getSourceIconData()
  const colors = iconState === "active" ? ACTIVE_ICON_COLORS : INACTIVE_ICON_COLORS
  const nextIcons = ICON_SIZES.reduce<Record<number, ImageData>>((acc, size) => {
    acc[size] = tintImageData(sourceIcon, colors.dark, colors.light, size)
    return acc
  }, {})

  iconImageCache[iconState] = nextIcons
  return nextIcons
}

async function updateBadgeCount(count: number) {
  await browser.action.setBadgeBackgroundColor({ color: BADGE_BG })
  await browser.action.setBadgeText({
    text: count > 0 ? (count > 99 ? "99+" : String(count)) : "",
  })
}

async function updateToolbarIcon(isActive: boolean) {
  const iconState: IconState = isActive ? "active" : "inactive"
  try {
    const imageData = await getIconImageData(iconState)
    await browser.action.setIcon({ imageData })
  } catch {
    await browser.action.setIcon({
      path: {
        16: "/icon-dark-32x32.png",
        32: "/icon-dark-32x32.png",
      },
    })
  }
}

async function updateActionState() {
  const [pending, origins, allowed] = await Promise.all([
    runtimeDb.pendingRequests
      .where("status")
      .equals("pending")
      .filter((item) => !item.dismissed)
      .count(),
    runtimeDb.origins.toArray(),
    runtimeDb.permissions.where("status").equals("allowed").toArray(),
  ])

  await updateBadgeCount(pending)

  const originEnabledMap = new Map(origins.map((origin) => [origin.origin, origin.enabled] as const))
  const active = allowed.some((rule) => originEnabledMap.get(rule.origin) !== false)
  await updateToolbarIcon(active)
}

function senderOrigin(url?: string) {
  if (!url) return "https://unknown.invalid"
  try {
    return new URL(url).origin
  } catch {
    return "https://unknown.invalid"
  }
}

async function handleMessage(message: BackgroundRpcMessage, sender: Browser.runtime.MessageSender) {
  const origin = (message.payload?.origin as string | undefined) ?? senderOrigin(sender.url)

  if (message.type === "runtime.providers.list") {
    return {
      ok: true,
      data: await listProviders(),
    }
  }

  if (message.type === "runtime.models.list") {
    return {
      ok: true,
      data: await listModels({
        providerID: message.payload?.providerID as string | undefined,
        connectedOnly: Boolean(message.payload?.connectedOnly),
      }),
    }
  }

  if (message.type === "runtime.origin.get") {
    return {
      ok: true,
      data: await getOriginState(origin),
    }
  }

  if (message.type === "runtime.permissions.list") {
    return {
      ok: true,
      data: await listPermissionsForOrigin(origin),
    }
  }

  if (message.type === "runtime.pending.list") {
    return {
      ok: true,
      data: await listPendingRequestsForOrigin(origin),
    }
  }

  if (message.type === "runtime.get-auth-methods") {
    const providerID = message.payload?.providerID as string
    return {
      ok: true,
      data: await listProviderAuthMethods(providerID),
    }
  }

  if (message.type === "runtime.connect-provider") {
    const providerID = message.payload?.providerID as string
    const connected = await connectRuntimeProvider({
      providerID,
      methodID: message.payload?.methodID as string | undefined,
      values: (message.payload?.values as Record<string, string> | undefined) ?? {},
      code: message.payload?.code as string | undefined,
    })
    await updateActionState()
    return {
      ok: true,
      data: connected,
    }
  }

  if (message.type === "runtime.disconnect-provider") {
    const providerID = message.payload?.providerID as string
    const disconnected = await disconnectRuntimeProvider(providerID)
    await updateActionState()
    return {
      ok: true,
      data: disconnected,
    }
  }

  if (message.type === "runtime.update-permission") {
    const mode = message.payload?.mode as string | undefined
    let result: unknown
    if (mode === "origin") {
      result = await setRuntimeOriginEnabled({
        origin,
        enabled: Boolean(message.payload?.enabled),
      })
    } else {
      result = await updateRuntimePermission({
        origin,
        modelId: message.payload?.modelId as string,
        status: message.payload?.status as "allowed" | "denied",
        capabilities: message.payload?.capabilities as string[] | undefined,
      })
    }

    await updateActionState()
    return {
      ok: true,
      data: result,
    }
  }

  if (message.type === "runtime.request-permission") {
    const action = message.payload?.action as string | undefined
    let result: unknown
    if (action === "resolve") {
      result = await resolveRuntimePermissionRequest({
        requestId: message.payload?.requestId as string,
        decision: message.payload?.decision as "allowed" | "denied",
      })
    } else if (action === "dismiss") {
      result = await dismissRuntimePermissionRequest(message.payload?.requestId as string)
    } else {
      const modelId =
        (message.payload?.modelId as string | undefined) ??
        "openai/gpt-4o-mini"
      const parsed = parseProviderModel(modelId)
      result = await createRuntimePermissionRequest({
        origin,
        modelId,
        modelName:
          (message.payload?.modelName as string | undefined) ??
          parsed.modelID,
        provider:
          (message.payload?.provider as string | undefined) ??
          parsed.providerID,
        capabilities: message.payload?.capabilities as string[] | undefined,
      })
    }

    await updateActionState()
    return {
      ok: true,
      data: result,
    }
  }

  if (message.type === "runtime.invoke") {
    const requestId = message.payload?.requestId as string
    if (message.payload?.action === "abort") {
      streamControllers.get(requestId)?.abort()
      streamControllers.delete(requestId)
      return { ok: true }
    }

    const controller = new AbortController()
    streamControllers.set(requestId, controller)

    try {
      const result = await invokeRuntimeModel(
        {
          origin,
          sessionID: (message.payload?.sessionID as string | undefined) ?? requestId,
          requestID: requestId,
          model: message.payload?.model as string,
          stream: false,
          body: (message.payload?.body as Record<string, unknown> | undefined) ?? {},
        },
        controller.signal,
      )
      return {
        ok: true,
        data: result,
      }
    } finally {
      streamControllers.delete(requestId)
    }
  }

  if (message.type === "runtime.abort") {
    const requestId = message.payload?.requestId as string
    streamControllers.get(requestId)?.abort()
    streamControllers.delete(requestId)
    return { ok: true }
  }

  return {
    ok: false,
    error: `Unknown runtime message type: ${message.type}`,
  }
}

function handleStreamPort(port: Browser.runtime.Port) {
  if (port.name !== STREAM_PORT) return

  let requestId = ""
  let controller: AbortController | undefined

  port.onMessage.addListener(async (message: Record<string, unknown>) => {
    if (message?.type === "abort") {
      if (requestId) {
        streamControllers.get(requestId)?.abort()
        streamControllers.delete(requestId)
      }
      controller?.abort()
      return
    }

    if (message?.type !== "invoke") return

    requestId = message.requestId as string
    controller = new AbortController()
    streamControllers.set(requestId, controller)

    try {
      const origin = (message.origin as string | undefined) ?? senderOrigin(port.sender?.url)
      const sessionID = (message.sessionID as string | undefined) ?? requestId
      const result = await invokeRuntimeModel(
        {
          origin,
          sessionID,
          requestID: requestId,
          model: message.model as string,
          stream: true,
          body: (message.body as Record<string, unknown> | undefined) ?? {},
        },
        controller.signal,
      )

      if (!result.stream || !result.response.body) {
        port.postMessage({ type: "done", requestId })
        return
      }

      const reader = result.response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        const data = decoder.decode(chunk.value, { stream: true })
        port.postMessage({ type: "chunk", requestId, data })
      }

      port.postMessage({ type: "done", requestId })
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      port.postMessage({ type: "error", requestId, error: messageText })
    } finally {
      streamControllers.delete(requestId)
    }
  })

  port.onDisconnect.addListener(() => {
    if (!requestId) return
    streamControllers.get(requestId)?.abort()
    streamControllers.delete(requestId)
  })
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export default defineBackground(() => {
  // Avoid eager network fetches on worker boot to keep popup open fast.
  // Models stay fresh through startup/install hooks and the periodic alarm.
  void scheduleModelsRefreshAlarm()
  void ensureProviderCatalog()

  void updateActionState()

  browser.runtime.onInstalled.addListener(() => {
    void refreshModelsSnapshotOnce()
    void refreshCatalog()
    void scheduleModelsRefreshAlarm()
    void updateActionState()
  })

  browser.runtime.onStartup.addListener(() => {
    void refreshModelsSnapshotOnce()
    void refreshCatalog()
    void scheduleModelsRefreshAlarm()
    void updateActionState()
  })

  browser.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name !== MODELS_REFRESH_ALARM) return
    void refreshModelsSnapshotOnce()
  })

  browser.runtime.onMessage.addListener((message: BackgroundRpcMessage, sender, sendResponse) => {
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      sendResponse({
        ok: false,
        error: "Invalid runtime message payload",
      })
      return false
    }

    void handleMessage(message, sender)
      .then((result) => {
        sendResponse(result)
      })
      .catch((error: unknown) => {
        const messageText = toErrorMessage(error)
        console.error("Background message handler failed", error)
        sendResponse({
          ok: false,
          error: messageText,
        })
      })

    return true
  })

  browser.runtime.onConnect.addListener((port: Browser.runtime.Port) => {
    handleStreamPort(port)
  })

  subscribeRuntimeEvents(() => {
    void updateActionState()
  })

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    if (!changes["llm-bridge-runtime-state-v2"]) return
    void updateActionState()
  })
})
