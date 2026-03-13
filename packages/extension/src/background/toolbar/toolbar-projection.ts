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
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
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

type ToolbarProjectionState = {
  readonly originStates: ReadonlyMap<string, RuntimeOriginState>;
  readonly permissionsByOrigin: ReadonlyMap<
    string,
    ReadonlyArray<RuntimePermissionEntry>
  >;
  readonly pendingByOrigin: ReadonlyMap<
    string,
    ReadonlyArray<RuntimePendingRequest>
  >;
  readonly connectedModels: ReadonlyArray<RuntimeModelSummary>;
};

function initialToolbarProjectionState(): ToolbarProjectionState {
  return {
    originStates: new Map(),
    permissionsByOrigin: new Map(),
    pendingByOrigin: new Map(),
    connectedModels: [],
  };
}

function iconColors(iconState: IconState): { dark: Rgb; light: Rgb } {
  return iconState === "active" ? ACTIVE_ICON_COLORS : INACTIVE_ICON_COLORS;
}

function getSourceIconData(
  sourceIconRef: SynchronizedRef.SynchronizedRef<ImageData | null>,
) {
  return SynchronizedRef.modifyEffect(sourceIconRef, (cachedImage) => {
    if (cachedImage) {
      return Effect.succeed([cachedImage, cachedImage] as const);
    }

    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch(browser.runtime.getURL(SOURCE_ICON_PATH)),
        catch: (error) => error,
      });
      const blob = yield* Effect.tryPromise({
        try: () => response.blob(),
        catch: (error) => error,
      });
      const bitmap = yield* Effect.tryPromise({
        try: () => createImageBitmap(blob),
        catch: (error) => error,
      });
      const canvas = yield* Effect.sync(
        () => new OffscreenCanvas(bitmap.width, bitmap.height),
      );
      const context = yield* Effect.try({
        try: () => {
          const nextContext = canvas.getContext("2d");
          if (!nextContext) {
            throw new Error("Failed to initialize icon drawing context");
          }
          return nextContext;
        },
        catch: (error) => error,
      });

      yield* Effect.sync(() => {
        context.drawImage(bitmap, 0, 0);
      });

      const imageData = yield* Effect.try({
        try: () => context.getImageData(0, 0, bitmap.width, bitmap.height),
        catch: (error) => error,
      });

      return [imageData, imageData] as const;
    });
  });
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

function getIconImageData(input: {
  iconState: IconState;
  sourceIconRef: SynchronizedRef.SynchronizedRef<ImageData | null>;
  iconImageCacheRef: SynchronizedRef.SynchronizedRef<
    Partial<Record<IconState, Record<number, ImageData>>>
  >;
}) {
  return SynchronizedRef.modifyEffect(input.iconImageCacheRef, (cache) => {
    const cachedIcons = cache[input.iconState];
    if (cachedIcons) {
      return Effect.succeed([cachedIcons, cache] as const);
    }

    return Effect.gen(function* () {
      const sourceIcon = yield* getSourceIconData(input.sourceIconRef);
      const colors = iconColors(input.iconState);
      const nextIcons = ICON_SIZES.reduce<Record<number, ImageData>>(
        (acc, size) => {
          acc[size] = tintImageData(sourceIcon, colors.dark, colors.light, size);
          return acc;
        },
        {},
      );

      return [
        nextIcons,
        {
          ...cache,
          [input.iconState]: nextIcons,
        },
      ] as const;
    });
  });
}

function getActiveTabOrigin() {
  if (!browser.tabs?.query) {
    return Effect.succeed<string | null>(null);
  }

  return Effect.tryPromise({
    try: () =>
      browser.tabs.query({
        active: true,
        lastFocusedWindow: true,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.map(([activeTab]) => tabUrlOrigin(activeTab?.url)),
    Effect.catchAll(() => Effect.succeed(null)),
  );
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

function updateBadgeCount(count: number) {
  return Effect.tryPromise({
    try: async () => {
      await browser.action.setBadgeBackgroundColor({ color: BADGE_BG });
      await browser.action.setBadgeText({
        text: count > 0 ? (count > 99 ? "99+" : String(count)) : "",
      });
    },
    catch: (error) => error,
  });
}

function updateToolbarIcon(input: {
  isActive: boolean;
  sourceIconRef: SynchronizedRef.SynchronizedRef<ImageData | null>;
  iconImageCacheRef: SynchronizedRef.SynchronizedRef<
    Partial<Record<IconState, Record<number, ImageData>>>
  >;
}) {
  const iconState: IconState = input.isActive ? "active" : "inactive";
  const fallbackIcon = Effect.tryPromise({
    try: () =>
      browser.action.setIcon({
        path: {
          16: SOURCE_ICON_PATH,
          32: SOURCE_ICON_PATH,
        },
      }),
    catch: (error) => error,
  });

  return getIconImageData({
    iconState,
    sourceIconRef: input.sourceIconRef,
    iconImageCacheRef: input.iconImageCacheRef,
  }).pipe(
    Effect.flatMap((imageData) =>
      Effect.tryPromise({
        try: () => browser.action.setIcon({ imageData }),
        catch: (error) => error,
      }),
    ),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.warn("toolbar icon update failed", error);
      }).pipe(Effect.zipRight(fallbackIcon)),
    ),
  );
}

export const ToolbarProjectionLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const catalog = yield* CatalogService;
    const permissions = yield* PermissionsService;

    const projectionStateRef = yield* Ref.make(initialToolbarProjectionState());
    const revisionRef = yield* Ref.make(0);
    const sourceIconRef = yield* SynchronizedRef.make<ImageData | null>(null);
    const iconImageCacheRef = yield* SynchronizedRef.make<
      Partial<Record<IconState, Record<number, ImageData>>>
    >({});

    const updateActionState = Effect.gen(function* () {
      const currentRevision = yield* Ref.updateAndGet(revisionRef, (value) => value + 1);
      const state = yield* Ref.get(projectionStateRef);
      const activeOrigin = yield* getActiveTabOrigin();
      const pendingCount = sumPendingRequests(state.pendingByOrigin);
      const active = isActiveForOrigin({
        activeOrigin,
        originStates: state.originStates,
        permissionsByOrigin: state.permissionsByOrigin,
        connectedModels: state.connectedModels,
      });

      if ((yield* Ref.get(revisionRef)) !== currentRevision) {
        return;
      }

      yield* updateBadgeCount(pendingCount);

      if ((yield* Ref.get(revisionRef)) !== currentRevision) {
        return;
      }

      yield* updateToolbarIcon({
        isActive: active,
        sourceIconRef,
        iconImageCacheRef,
      });
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
        Stream.runForEach((connectedModels) =>
          Ref.update(projectionStateRef, (state) => ({
            ...state,
            connectedModels,
          })).pipe(Effect.zipRight(updateActionState)),
        ),
        Effect.forkScoped,
      );

    yield* permissions
      .streamOriginStates()
      .pipe(
        Stream.runForEach((originStates) =>
          Ref.update(projectionStateRef, (state) => ({
            ...state,
            originStates: new Map(originStates),
          })).pipe(Effect.zipRight(updateActionState)),
        ),
        Effect.forkScoped,
      );

    yield* permissions
      .streamPermissionsMap()
      .pipe(
        Stream.runForEach((permissionsByOrigin) =>
          Ref.update(projectionStateRef, (state) => ({
            ...state,
            permissionsByOrigin: new Map(permissionsByOrigin),
          })).pipe(Effect.zipRight(updateActionState)),
        ),
        Effect.forkScoped,
      );

    yield* permissions
      .streamPendingMap()
      .pipe(
        Stream.runForEach((pendingByOrigin) =>
          Ref.update(projectionStateRef, (state) => ({
            ...state,
            pendingByOrigin: new Map(pendingByOrigin),
          })).pipe(Effect.zipRight(updateActionState)),
        ),
        Effect.forkScoped,
      );

    const onTabActivated: Parameters<typeof browser.tabs.onActivated.addListener>[0] =
      () => {
        Effect.runFork(updateActionState);
      };

    const onTabUpdated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] =
      (_tabId, changeInfo, tabInfo) => {
        if (!tabInfo.active) {
          return;
        }
        if (changeInfo.url == null && changeInfo.status == null) {
          return;
        }

        Effect.runFork(updateActionState);
      };

    const onWindowFocusChanged: Parameters<typeof browser.windows.onFocusChanged.addListener>[0] =
      () => {
        Effect.runFork(updateActionState);
      };

    yield* Effect.sync(() => {
      browser.tabs?.onActivated.addListener(onTabActivated);
      browser.tabs?.onUpdated.addListener(onTabUpdated);
      browser.windows?.onFocusChanged.addListener(onWindowFocusChanged);
    });

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
