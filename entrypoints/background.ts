import { browser } from "@wxt-dev/browser"
import { defineBackground } from "wxt/utils/define-background"
import {
  INITIAL_PENDING_REQUESTS,
  INITIAL_PERMISSIONS,
  type ModelPermission,
  type PermissionRequest,
} from "@/lib/mock-data"

const STORE_KEY = "llm-bridge-extension-state"
const BADGE_BG = "#d97706"
const SOURCE_ICON_PATH = "/icon-dark-32x32.png"
const ICON_SIZES = [16, 32] as const

const ACTIVE_ICON_COLORS = {
  dark: { r: 20, g: 83, b: 45 },
  light: { r: 134, g: 239, b: 172 },
}

const INACTIVE_ICON_COLORS = {
  dark: { r: 71, g: 85, b: 105 },
  light: { r: 203, g: 213, b: 225 },
}

type PersistedStoreValue = {
  pendingRequests?: unknown
  permissions?: unknown
  originEnabled?: unknown
  state?: { pendingRequests?: unknown; permissions?: unknown; originEnabled?: unknown }
}

function parseStoreValue(value: unknown): PersistedStoreValue | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === "object") {
        return parsed as PersistedStoreValue
      }
      return null
    } catch {
      return null
    }
  }

  if (value && typeof value === "object") {
    return value as PersistedStoreValue
  }

  return null
}

function getPendingRequests(value: unknown): PermissionRequest[] {
  const parsed = parseStoreValue(value)
  if (!parsed) return INITIAL_PENDING_REQUESTS

  const raw = parsed.state?.pendingRequests ?? parsed.pendingRequests
  if (!Array.isArray(raw)) return INITIAL_PENDING_REQUESTS
  return raw as PermissionRequest[]
}

function getPermissions(value: unknown): ModelPermission[] {
  const parsed = parseStoreValue(value)
  if (!parsed) return INITIAL_PERMISSIONS

  const raw = parsed.state?.permissions ?? parsed.permissions
  if (!Array.isArray(raw)) return INITIAL_PERMISSIONS
  return raw as ModelPermission[]
}

function isOriginEnabled(value: unknown): boolean {
  const parsed = parseStoreValue(value)
  if (!parsed) return true

  const raw = parsed.state?.originEnabled ?? parsed.originEnabled
  return typeof raw === "boolean" ? raw : true
}

function hasActiveModels(value: unknown): boolean {
  if (!isOriginEnabled(value)) return false
  const permissions = getPermissions(value)
  return permissions.some((permission) => permission.status === "allowed")
}

async function updateBadgeCount(count: number) {
  await browser.action.setBadgeBackgroundColor({ color: BADGE_BG })
  await browser.action.setBadgeText({
    text: count > 0 ? (count > 99 ? "99+" : String(count)) : "",
  })
}

type Rgb = { r: number; g: number; b: number }
type IconState = "active" | "inactive"

let sourceIconPromise: Promise<ImageData> | null = null
const iconImageCache: Partial<Record<IconState, Record<number, ImageData>>> = {}

async function getSourceIconData(): Promise<ImageData> {
  if (sourceIconPromise) return sourceIconPromise

  sourceIconPromise = (async () => {
    const response = await fetch(browser.runtime.getURL(SOURCE_ICON_PATH))
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext("2d")
    if (!context) {
      throw new Error("Failed to initialize icon drawing context")
    }

    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height)
  })()

  return sourceIconPromise
}

function tintImageData(
  source: ImageData,
  dark: Rgb,
  light: Rgb,
  size: number
): ImageData {
  const sourceCanvas = new OffscreenCanvas(source.width, source.height)
  const sourceContext = sourceCanvas.getContext("2d")
  if (!sourceContext) {
    throw new Error("Failed to initialize source icon context")
  }
  sourceContext.putImageData(source, 0, 0)

  const canvas = new OffscreenCanvas(size, size)
  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("Failed to initialize tinted icon context")
  }
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

async function updateToolbarIcon(isActive: boolean) {
  const iconState: IconState = isActive ? "active" : "inactive"
  try {
    const imageData = await getIconImageData(iconState)
    await browser.action.setIcon({ imageData })
  } catch {
    // Fallback: keep extension icon usable even if runtime image generation fails.
    await browser.action.setIcon({
      path: {
        16: "/icon-dark-32x32.png",
        32: "/icon-dark-32x32.png",
      },
    })
  }
}

async function updateActionFromStoreValue(storeValue: unknown) {
  const pendingRequests = getPendingRequests(storeValue)
  await updateBadgeCount(pendingRequests.length)
  await updateToolbarIcon(hasActiveModels(storeValue))
}

async function updateActionFromStoredState() {
  const stored = await browser.storage.local.get(STORE_KEY)
  await updateActionFromStoreValue(stored[STORE_KEY])
}

export default defineBackground(() => {
  void updateActionFromStoredState()

  browser.runtime.onInstalled.addListener(() => {
    void updateActionFromStoredState()
  })

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORE_KEY]) return

    void updateActionFromStoreValue(changes[STORE_KEY].newValue)
  })
})
