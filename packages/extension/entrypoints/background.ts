import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeApplication,
  RuntimeApplicationLive,
} from "@llm-bridge/runtime-core";
import { browser } from "@wxt-dev/browser";
import { defineBackground } from "wxt/utils/define-background";
import {
  MODELS_REFRESH_INTERVAL_MS,
} from "@/lib/runtime/constants";
import {
  getModelsDevUpdatedAt,
  refreshModelsDevData,
} from "@/lib/runtime/models-dev";
import {
  ensureProviderCatalog,
  refreshProviderCatalog,
} from "@/lib/runtime/provider-registry";
import { runtimeDb } from "@/lib/runtime/db/runtime-db";
import { subscribeRuntimeEvents } from "@/lib/runtime/events/runtime-events";
import { getAuthFlowManager } from "@/lib/runtime/auth-flow-manager";
import { makeRuntimeCoreInfrastructureLayer } from "@/lib/runtime-app/runtime-adapters";
import { RuntimeRpcHandlersLive } from "@/lib/runtime-app/runtime-rpc-handlers";
import { registerRuntimeRpcServer } from "@/lib/runtime-app/runtime-rpc-server";

const BADGE_BG = "#d97706";
const SOURCE_ICON_PATH = "/icon-dark-32x32.png";
const ICON_SIZES = [16, 32] as const;
const MODELS_REFRESH_ALARM = "models-dev-refresh";

const ACTIVE_ICON_COLORS = {
  dark: { r: 20, g: 83, b: 45 },
  light: { r: 134, g: 239, b: 172 },
};

const INACTIVE_ICON_COLORS = {
  dark: { r: 71, g: 85, b: 105 },
  light: { r: 203, g: 213, b: 225 },
};

type Rgb = { r: number; g: number; b: number };
type IconState = "active" | "inactive";

let sourceIconPromise: Promise<ImageData> | null = null;
const iconImageCache: Partial<Record<IconState, Record<number, ImageData>>> =
  {};
let modelsRefreshInFlight: Promise<void> | null = null;

async function refreshModelsSnapshot() {
  try {
    const updatedAt = await getModelsDevUpdatedAt();
    if (updatedAt > 0 && Date.now() - updatedAt < MODELS_REFRESH_INTERVAL_MS) {
      return;
    }

    await refreshModelsDevData();
    await refreshProviderCatalog();
  } catch (error) {
    console.warn("models.dev refresh failed", error);
  }
}

function refreshModelsSnapshotOnce() {
  if (modelsRefreshInFlight) return modelsRefreshInFlight;

  modelsRefreshInFlight = refreshModelsSnapshot().finally(() => {
    modelsRefreshInFlight = null;
  });

  return modelsRefreshInFlight;
}

async function scheduleModelsRefreshAlarm() {
  if (!browser.alarms?.create) return;

  const periodInMinutes = Math.max(
    1,
    Math.floor(MODELS_REFRESH_INTERVAL_MS / 60_000),
  );
  await browser.alarms.create(MODELS_REFRESH_ALARM, {
    periodInMinutes,
  });
}

async function getSourceIconData(): Promise<ImageData> {
  if (sourceIconPromise) return sourceIconPromise;

  sourceIconPromise = (async () => {
    const response = await fetch(browser.runtime.getURL(SOURCE_ICON_PATH));
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Failed to initialize icon drawing context");

    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  })();

  return sourceIconPromise;
}

function tintImageData(
  source: ImageData,
  dark: Rgb,
  light: Rgb,
  size: number,
): ImageData {
  const sourceCanvas = new OffscreenCanvas(source.width, source.height);
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext)
    throw new Error("Failed to initialize source icon context");

  sourceContext.putImageData(source, 0, 0);

  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Failed to initialize tinted icon context");

  context.drawImage(sourceCanvas, 0, 0, size, size);

  const output = context.getImageData(0, 0, size, size);
  const data = output.data;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;

    const luminance = (data[i] + data[i + 1] + data[i + 2]) / (255 * 3);
    data[i] = Math.round(dark.r + (light.r - dark.r) * luminance);
    data[i + 1] = Math.round(dark.g + (light.g - dark.g) * luminance);
    data[i + 2] = Math.round(dark.b + (light.b - dark.b) * luminance);
  }

  return output;
}

async function getIconImageData(
  iconState: IconState,
): Promise<Record<number, ImageData>> {
  const cached = iconImageCache[iconState];
  if (cached) return cached;

  const sourceIcon = await getSourceIconData();
  const colors =
    iconState === "active" ? ACTIVE_ICON_COLORS : INACTIVE_ICON_COLORS;
  const nextIcons = ICON_SIZES.reduce<Record<number, ImageData>>(
    (acc, size) => {
      acc[size] = tintImageData(sourceIcon, colors.dark, colors.light, size);
      return acc;
    },
    {},
  );

  iconImageCache[iconState] = nextIcons;
  return nextIcons;
}

async function updateBadgeCount(count: number) {
  await browser.action.setBadgeBackgroundColor({ color: BADGE_BG });
  await browser.action.setBadgeText({
    text: count > 0 ? (count > 99 ? "99+" : String(count)) : "",
  });
}

async function updateToolbarIcon(isActive: boolean) {
  const iconState: IconState = isActive ? "active" : "inactive";
  try {
    const imageData = await getIconImageData(iconState);
    await browser.action.setIcon({ imageData });
  } catch {
    await browser.action.setIcon({
      path: {
        16: "/icon-dark-32x32.png",
        32: "/icon-dark-32x32.png",
      },
    });
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
  ]);

  await updateBadgeCount(pending);

  const originEnabledMap = new Map(
    origins.map((origin) => [origin.origin, origin.enabled] as const),
  );
  const active = allowed.some(
    (rule) => originEnabledMap.get(rule.origin) !== false,
  );
  await updateToolbarIcon(active);
}

function createRuntimeLayer() {
  const infrastructureLayer = makeRuntimeCoreInfrastructureLayer();

  const runtimeApplicationLayer = RuntimeApplicationLive.pipe(
    Layer.provide(infrastructureLayer),
  );

  const runtimeRpcHandlersLayer = RuntimeRpcHandlersLive.pipe(
    Layer.provide(runtimeApplicationLayer),
  );

  return Layer.merge(runtimeApplicationLayer, runtimeRpcHandlersLayer);
}

function startRuntimeCore(layer: ReturnType<typeof createRuntimeLayer>) {
  void Effect.runPromise(
    Effect.flatMap(RuntimeApplication, (app) => app.startup()).pipe(
      Effect.provide(layer),
    ),
  ).catch((error) => {
    console.warn("runtime startup failed", error);
  });

  void registerRuntimeRpcServer(layer).catch((error) => {
    console.warn("runtime rpc server failed", error);
  });
}

export default defineBackground(() => {
  const runtimeLayer = createRuntimeLayer();

  // Avoid eager network fetches on worker boot to keep popup open fast.
  // Models stay fresh through startup/install hooks and the periodic alarm.
  void scheduleModelsRefreshAlarm();
  void ensureProviderCatalog();

  startRuntimeCore(runtimeLayer);
  void updateActionState();

  browser.runtime.onInstalled.addListener(() => {
    void refreshModelsSnapshotOnce();
    void refreshProviderCatalog();
    void scheduleModelsRefreshAlarm();
    void updateActionState();
  });

  browser.runtime.onStartup.addListener(() => {
    void refreshModelsSnapshotOnce();
    void refreshProviderCatalog();
    void scheduleModelsRefreshAlarm();
    void updateActionState();
  });

  browser.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name !== MODELS_REFRESH_ALARM) return;
    void refreshModelsSnapshotOnce();
  });

  browser.windows?.onRemoved.addListener((windowId) => {
    void getAuthFlowManager().handleWindowClosed(windowId);
  });

  subscribeRuntimeEvents(() => {
    void updateActionState();
  });
});
