import { browser } from "@wxt-dev/browser";
import {
  CatalogService,
  PermissionsService,
} from "@llm-bridge/runtime-core";
import type {
  RuntimeModelSummary,
  RuntimeOriginState,
  RuntimePendingRequest,
  RuntimePermissionEntry,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  hasEnabledConnectedModel,
  tabUrlOrigin,
} from "@/background/runtime/permissions/toolbar-icon-state";

const BADGE_BG = "#d97706";
const SOURCE_ICON_PATH = "/icon-32x32.png";
const ICON_SIZES = [16, 32] as const;

const ACTIVE_ICON_COLORS = {
  dark: { r: 0, g: 198, b: 109 },
  light: { r: 0, g: 198, b: 109 },
};

const INACTIVE_ICON_COLORS = {
  dark: { r: 115, g: 134, b: 120 },
  light: { r: 115, g: 134, b: 120 },
};

type Rgb = { r: number; g: number; b: number };
type IconState = "active" | "inactive";

let sourceIconPromise: Promise<ImageData> | null = null;
const iconImageCache: Partial<Record<IconState, Record<number, ImageData>>> =
  {};

function iconColors(iconState: IconState): { dark: Rgb; light: Rgb } {
  return iconState === "active" ? ACTIVE_ICON_COLORS : INACTIVE_ICON_COLORS;
}

async function getSourceIconData(): Promise<ImageData> {
  if (sourceIconPromise) {
    return sourceIconPromise;
  }

  sourceIconPromise = (async () => {
    const response = await fetch(browser.runtime.getURL(SOURCE_ICON_PATH));
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to initialize icon drawing context");
    }

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
  if (!sourceContext) {
    throw new Error("Failed to initialize source icon context");
  }

  sourceContext.putImageData(source, 0, 0);

  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to initialize tinted icon context");
  }

  context.drawImage(sourceCanvas, 0, 0, size, size);

  const output = context.getImageData(0, 0, size, size);
  const data = output.data;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) {
      continue;
    }

    const luminance =
      (data[index] + data[index + 1] + data[index + 2]) / (255 * 3);
    data[index] = Math.round(dark.r + (light.r - dark.r) * luminance);
    data[index + 1] = Math.round(dark.g + (light.g - dark.g) * luminance);
    data[index + 2] = Math.round(dark.b + (light.b - dark.b) * luminance);
  }

  return output;
}

async function getIconImageData(
  iconState: IconState,
): Promise<Record<number, ImageData>> {
  const cached = iconImageCache[iconState];
  if (cached) {
    return cached;
  }

  const sourceIcon = await getSourceIconData();
  const colors = iconColors(iconState);
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

async function getActiveTabOrigin() {
  if (!browser.tabs?.query) {
    return null;
  }

  try {
    const [activeTab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    return tabUrlOrigin(activeTab?.url);
  } catch {
    return null;
  }
}

function sumPendingRequests(
  pendingByOrigin: ReadonlyMap<string, ReadonlyArray<RuntimePendingRequest>>,
) {
  let count = 0;
  for (const entries of pendingByOrigin.values()) {
    count += entries.length;
  }
  return count;
}

function isActiveForOrigin(input: {
  activeOrigin: string | null;
  originStates: ReadonlyMap<string, RuntimeOriginState>;
  permissionsByOrigin: ReadonlyMap<string, ReadonlyArray<RuntimePermissionEntry>>;
  connectedModels: ReadonlyArray<RuntimeModelSummary>;
}) {
  if (!input.activeOrigin) {
    return false;
  }

  const originState = input.originStates.get(input.activeOrigin);
  const permissions = input.permissionsByOrigin.get(input.activeOrigin) ?? [];
  const allowedModelIds = permissions
    .filter((entry) => entry.status === "allowed")
    .map((entry) => entry.modelId);

  return hasEnabledConnectedModel({
    originEnabled: originState?.enabled ?? true,
    allowedModelIds,
    connectedModelIds: new Set(
      input.connectedModels
        .filter((model) => model.connected)
        .map((model) => model.id),
    ),
  });
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
  } catch (error) {
    console.warn("toolbar icon update failed", error);
    await browser.action.setIcon({
      path: {
        16: SOURCE_ICON_PATH,
        32: SOURCE_ICON_PATH,
      },
    });
  }
}

export const ToolbarProjectionLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const catalog = yield* CatalogService;
    const permissions = yield* PermissionsService;

    let originStates = new Map<string, RuntimeOriginState>();
    let permissionsByOrigin = new Map<
      string,
      ReadonlyArray<RuntimePermissionEntry>
    >();
    let pendingByOrigin = new Map<string, ReadonlyArray<RuntimePendingRequest>>();
    let connectedModels: ReadonlyArray<RuntimeModelSummary> = [];
    let revision = 0;

    const updateActionState = Effect.tryPromise({
      try: async () => {
        const currentRevision = ++revision;
        const activeOrigin = await getActiveTabOrigin();
        const pendingCount = sumPendingRequests(pendingByOrigin);
        const active = isActiveForOrigin({
          activeOrigin,
          originStates,
          permissionsByOrigin,
          connectedModels,
        });

        if (currentRevision !== revision) {
          return;
        }

        await updateBadgeCount(pendingCount);

        if (currentRevision !== revision) {
          return;
        }

        await updateToolbarIcon(active);
      },
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.warn("toolbar projection update failed", error);
        }),
      ),
    );

    yield* catalog
      .streamModels({
        connectedOnly: true,
      })
      .pipe(
        Stream.runForEach((models) =>
          Effect.sync(() => {
            connectedModels = models;
          }).pipe(Effect.zipRight(updateActionState)),
        ),
        Effect.forkScoped,
      );

    yield* permissions
      .streamOriginStates()
      .pipe(
        Stream.runForEach((nextOriginStates) =>
          Effect.sync(() => {
            originStates = new Map(nextOriginStates);
          }).pipe(Effect.zipRight(updateActionState)),
        ),
        Effect.forkScoped,
      );

    yield* permissions
      .streamPermissionsMap()
      .pipe(
        Stream.runForEach((nextPermissions) =>
          Effect.sync(() => {
            permissionsByOrigin = new Map(nextPermissions);
          }).pipe(Effect.zipRight(updateActionState)),
        ),
        Effect.forkScoped,
      );

    yield* permissions
      .streamPendingMap()
      .pipe(
        Stream.runForEach((nextPending) =>
          Effect.sync(() => {
            pendingByOrigin = new Map(nextPending);
          }).pipe(Effect.zipRight(updateActionState)),
        ),
        Effect.forkScoped,
      );

    const onTabActivated: Parameters<typeof browser.tabs.onActivated.addListener>[0] =
      () => {
        void Effect.runPromise(updateActionState).catch(() => undefined);
      };

    const onTabUpdated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] =
      (_tabId, changeInfo, tabInfo) => {
        if (!tabInfo.active) {
          return;
        }
        if (changeInfo.url == null && changeInfo.status == null) {
          return;
        }

        void Effect.runPromise(updateActionState).catch(() => undefined);
      };

    const onWindowFocusChanged: Parameters<typeof browser.windows.onFocusChanged.addListener>[0] =
      () => {
        void Effect.runPromise(updateActionState).catch(() => undefined);
      };

    browser.tabs?.onActivated.addListener(onTabActivated);
    browser.tabs?.onUpdated.addListener(onTabUpdated);
    browser.windows?.onFocusChanged.addListener(onWindowFocusChanged);

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        browser.tabs?.onActivated.removeListener(onTabActivated);
        browser.tabs?.onUpdated.removeListener(onTabUpdated);
        browser.windows?.onFocusChanged.removeListener(onWindowFocusChanged);
      }),
    );

    yield* updateActionState;
  }),
);
