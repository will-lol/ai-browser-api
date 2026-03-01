import { browser } from "@wxt-dev/browser"
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"
import { defineBackground } from "wxt/utils/define-background"
import { MODELS_REFRESH_INTERVAL_MS, RUNTIME_STATE_KEY } from "@/lib/runtime/constants"
import { getModelsDevUpdatedAt, refreshModelsDevData } from "@/lib/runtime/models-dev"
import {
  acquireRuntimeModel,
  generateRuntimeModel,
  streamRuntimeModel,
} from "@/lib/runtime/service"
import {
  cancelRuntimeProviderAuthFlow,
  getRuntimeProviderAuthFlow,
  openRuntimeProviderAuthWindow,
  retryRuntimeProviderAuthFlow,
  startRuntimeProviderAuthFlow,
  submitRuntimeProviderAuthCode,
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
  listProviders,
} from "@/lib/runtime/query-service"
import { ensureProviderCatalog, refreshProviderCatalog } from "@/lib/runtime/provider-registry"
import { runtimeDb } from "@/lib/runtime/db/runtime-db"
import { subscribeRuntimeEvents } from "@/lib/runtime/events/runtime-events"
import { getAuthFlowManager } from "@/lib/runtime/auth-flow-manager"
import {
  RUNTIME_RPC_PORT_NAME,
  type RuntimeAcquireModelInput,
  type RuntimeAcquireModelResult,
  type RuntimeModelCallInput,
  type RuntimeRPCService,
} from "@/lib/runtime/rpc/runtime-rpc-types"
import { parseProviderModel } from "@/lib/runtime/util"

const BADGE_BG = "#d97706"
const SOURCE_ICON_PATH = "/icon-dark-32x32.png"
const ICON_SIZES = [16, 32] as const
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
type ChromeRuntimePort = ConstructorParameters<typeof ChromePortIO>[0]

let sourceIconPromise: Promise<ImageData> | null = null
const iconImageCache: Partial<Record<IconState, Record<number, ImageData>>> = {}

const activeRequestControllers = new Map<string, AbortController>()
let modelsRefreshInFlight: Promise<void> | null = null

async function refreshModelsSnapshot() {
  try {
    const updatedAt = await getModelsDevUpdatedAt()
    if (updatedAt > 0 && Date.now() - updatedAt < MODELS_REFRESH_INTERVAL_MS) {
      return
    }

    await refreshModelsDevData()
    await refreshProviderCatalog()
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

function getRequestOrigin(origin?: string) {
  return origin ?? "https://unknown.invalid"
}

function cancelRequest(requestId: string) {
  activeRequestControllers.get(requestId)?.abort()
  activeRequestControllers.delete(requestId)
}

async function acquireModel(input: RuntimeAcquireModelInput): Promise<RuntimeAcquireModelResult> {
  const requestId = input.requestId
  return acquireRuntimeModel({
    origin: getRequestOrigin(input.origin),
    sessionID: input.sessionID ?? requestId,
    requestID: requestId,
    model: input.modelId,
  })
}

async function modelDoGenerate(input: RuntimeModelCallInput) {
  const requestId = input.requestId
  const controller = new AbortController()
  activeRequestControllers.set(requestId, controller)
  try {
    return generateRuntimeModel(
      {
        origin: getRequestOrigin(input.origin),
        sessionID: input.sessionID ?? requestId,
        requestID: requestId,
        model: input.modelId,
        options: input.options,
      },
      controller.signal,
    )
  } finally {
    activeRequestControllers.delete(requestId)
  }
}

async function* modelDoStream(input: RuntimeModelCallInput) {
  const requestId = input.requestId
  const controller = new AbortController()
  activeRequestControllers.set(requestId, controller)

  try {
    const stream = await streamRuntimeModel(
      {
        origin: getRequestOrigin(input.origin),
        sessionID: input.sessionID ?? requestId,
        requestID: requestId,
        model: input.modelId,
        options: input.options,
      },
      controller.signal,
    )

    const reader = stream.getReader()

    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        if (!chunk.value) continue
        yield chunk.value
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        // Ignore reader cancellation errors during stream teardown.
      }
    }
  } finally {
    controller.abort()
    activeRequestControllers.delete(requestId)
  }
}

const runtimeService: RuntimeRPCService = {
  async listProviders() {
    return listProviders()
  },
  async listModels(input) {
    return listModels({
      providerID: input.providerID,
      connectedOnly: Boolean(input.connectedOnly),
    })
  },
  async listConnectedModels(input) {
    void input
    return listModels({
      connectedOnly: true,
    })
  },
  async getOriginState(input) {
    return getOriginState(getRequestOrigin(input.origin))
  },
  async listPermissions(input) {
    return listPermissionsForOrigin(getRequestOrigin(input.origin))
  },
  async listPending(input) {
    return listPendingRequestsForOrigin(getRequestOrigin(input.origin))
  },
  async openProviderAuthWindow(input) {
    const response = await openRuntimeProviderAuthWindow(input.providerID)
    return response
  },
  async getProviderAuthFlow(input) {
    return getRuntimeProviderAuthFlow(input.providerID)
  },
  async startProviderAuthFlow(input) {
    const response = await startRuntimeProviderAuthFlow({
      providerID: input.providerID,
      methodIndex: input.methodIndex,
      values: input.values ?? {},
    })
    await updateActionState()
    return response
  },
  async submitProviderAuthCode(input) {
    const response = await submitRuntimeProviderAuthCode({
      providerID: input.providerID,
      code: input.code,
    })
    await updateActionState()
    return response
  },
  async retryProviderAuthFlow(input) {
    const response = await retryRuntimeProviderAuthFlow(input.providerID)
    await updateActionState()
    return response
  },
  async cancelProviderAuthFlow(input) {
    const response = await cancelRuntimeProviderAuthFlow({
      providerID: input.providerID,
      reason: input.reason,
    })
    await updateActionState()
    return response
  },
  async disconnectProvider(input) {
    const response = await disconnectRuntimeProvider(input.providerID)
    await updateActionState()
    return response
  },
  async updatePermission(input) {
    const origin = getRequestOrigin(input.origin)
    const result = input.mode === "origin"
      ? await setRuntimeOriginEnabled({
          origin,
          enabled: input.enabled,
        })
      : await updateRuntimePermission({
          origin,
          modelId: input.modelId,
          status: input.status,
          capabilities: input.capabilities,
        })

    await updateActionState()
    return result
  },
  async requestPermission(input) {
    const origin = getRequestOrigin(input.origin)
    let result
    if (input.action === "resolve") {
      result = await resolveRuntimePermissionRequest({
        requestId: input.requestId,
        decision: input.decision,
      })
    } else if (input.action === "dismiss") {
      result = await dismissRuntimePermissionRequest(input.requestId)
    } else {
      const modelId = input.modelId ?? "openai/gpt-4o-mini"
      const parsed = parseProviderModel(modelId)
      result = await createRuntimePermissionRequest({
        origin,
        modelId,
        modelName: input.modelName ?? parsed.modelID,
        provider: input.provider ?? parsed.providerID,
        capabilities: input.capabilities,
      })
    }

    await updateActionState()
    return result
  },
  async acquireModel(input) {
    return acquireModel(input)
  },
  async modelDoGenerate(input) {
    return modelDoGenerate(input)
  },
  modelDoStream(input) {
    return modelDoStream(input)
  },
  async abortModelCall(input) {
    cancelRequest(input.requestId)
  },
}

function registerRuntimeRPCHandlers() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== RUNTIME_RPC_PORT_NAME) return

    const io = new ChromePortIO(port as unknown as ChromeRuntimePort)
    const rpc = new RPCChannel<RuntimeRPCService, Record<string, never>>(io, {
      expose: runtimeService,
    })

    port.onDisconnect.addListener(() => {
      rpc.destroy()
    })
  })
}

export default defineBackground(() => {
  // Avoid eager network fetches on worker boot to keep popup open fast.
  // Models stay fresh through startup/install hooks and the periodic alarm.
  void scheduleModelsRefreshAlarm()
  void ensureProviderCatalog()

  void updateActionState()

  browser.runtime.onInstalled.addListener(() => {
    void refreshModelsSnapshotOnce()
    void refreshProviderCatalog()
    void scheduleModelsRefreshAlarm()
    void updateActionState()
  })

  browser.runtime.onStartup.addListener(() => {
    void refreshModelsSnapshotOnce()
    void refreshProviderCatalog()
    void scheduleModelsRefreshAlarm()
    void updateActionState()
  })

  browser.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name !== MODELS_REFRESH_ALARM) return
    void refreshModelsSnapshotOnce()
  })

  browser.windows?.onRemoved.addListener((windowId) => {
    void getAuthFlowManager().handleWindowClosed(windowId)
  })

  registerRuntimeRPCHandlers()

  subscribeRuntimeEvents(() => {
    void updateActionState()
  })

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    if (!changes[RUNTIME_STATE_KEY]) return
    void updateActionState()
  })
})
