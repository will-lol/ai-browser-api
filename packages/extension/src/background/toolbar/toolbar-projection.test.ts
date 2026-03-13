import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  CatalogService,
  PermissionsService,
  type CatalogServiceApi,
  type PermissionsServiceApi,
} from "@llm-bridge/runtime-core";
import type {
  RuntimeModelSummary,
  RuntimeOriginState,
  RuntimePendingRequest,
  RuntimePermissionEntry,
} from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

const tabActivatedListeners = new Set<() => void>();
const tabUpdatedListeners = new Set<
  (tabId: number, changeInfo: { url?: string; status?: string }, tabInfo: {
    active?: boolean;
    url?: string;
  }) => void
>();
const windowFocusChangedListeners = new Set<() => void>();

const setBadgeBackgroundColorMock = mock(async (_input: { color: string }) => {});
const setBadgeTextMock = mock(async (_input: { text: string }) => {});
const setIconMock = mock(
  async (
    _input:
      | { imageData: Record<number, ImageData> }
      | { path: Record<number, string> },
  ) => {},
);
const queryTabsMock = mock(
  async () =>
    activeTabUrl
      ? [
          {
            active: true,
            url: activeTabUrl,
          },
        ]
      : [],
);

let activeTabUrl: string | undefined = undefined;
let shouldFailContext = false;

mock.module("@wxt-dev/browser", () => ({
  browser: {
    runtime: {
      getURL: (path: string) => `chrome-extension://test${path}`,
    },
    action: {
      setBadgeBackgroundColor: setBadgeBackgroundColorMock,
      setBadgeText: setBadgeTextMock,
      setIcon: setIconMock,
    },
    tabs: {
      query: queryTabsMock,
      onActivated: {
        addListener(listener: () => void) {
          tabActivatedListeners.add(listener);
        },
        removeListener(listener: () => void) {
          tabActivatedListeners.delete(listener);
        },
      },
      onUpdated: {
        addListener(
          listener: (
            tabId: number,
            changeInfo: { url?: string; status?: string },
            tabInfo: { active?: boolean; url?: string },
          ) => void,
        ) {
          tabUpdatedListeners.add(listener);
        },
        removeListener(
          listener: (
            tabId: number,
            changeInfo: { url?: string; status?: string },
            tabInfo: { active?: boolean; url?: string },
          ) => void,
        ) {
          tabUpdatedListeners.delete(listener);
        },
      },
    },
    windows: {
      onFocusChanged: {
        addListener(listener: () => void) {
          windowFocusChangedListeners.add(listener);
        },
        removeListener(listener: () => void) {
          windowFocusChangedListeners.delete(listener);
        },
      },
    },
  },
}));

const fetchMock = mock(async (_input: string) => ({
  blob: async () => new Blob(["icon"]),
}));
const createImageBitmapMock = mock(async (_blob: Blob) => ({
  width: 32,
  height: 32,
}));
const warnMock = mock((_message?: unknown, _details?: unknown) => {});

const originalFetch = globalThis.fetch;
const originalImageData = Reflect.get(globalThis, "ImageData");
const originalCreateImageBitmap = Reflect.get(globalThis, "createImageBitmap");
const originalOffscreenCanvas = Reflect.get(globalThis, "OffscreenCanvas");
const originalConsoleWarn = console.warn;

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

class FakeCanvasRenderingContext2D {
  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  drawImage(..._args: ReadonlyArray<unknown>) {}

  putImageData(..._args: ReadonlyArray<unknown>) {}

  getImageData(
    _x: number,
    _y: number,
    width: number = this.width,
    height: number = this.height,
  ) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 255;
      pixels[index + 1] = 255;
      pixels[index + 2] = 255;
      pixels[index + 3] = 255;
    }
    return new FakeImageData(pixels, width, height) as unknown as ImageData;
  }
}

class FakeOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  getContext(_kind: "2d") {
    if (shouldFailContext) {
      return null;
    }
    return new FakeCanvasRenderingContext2D(this.width, this.height);
  }
}

const ACTIVE_ICON_RGB = [0, 198, 109];
const INACTIVE_ICON_RGB = [115, 134, 120];

let modelsPubSub!: PubSub.PubSub<ReadonlyArray<RuntimeModelSummary>>;
let originStatesPubSub!: PubSub.PubSub<ReadonlyMap<string, RuntimeOriginState>>;
let permissionsPubSub!: PubSub.PubSub<
  ReadonlyMap<string, ReadonlyArray<RuntimePermissionEntry>>
>;
let pendingPubSub!: PubSub.PubSub<
  ReadonlyMap<string, ReadonlyArray<RuntimePendingRequest>>
>;

const { ToolbarProjectionLive } = await import("./toolbar-projection");

function emitTabActivated() {
  for (const listener of [...tabActivatedListeners]) {
    listener();
  }
}

function emitTabUpdated(input: {
  changeInfo: { url?: string; status?: string };
  tabInfo: { active?: boolean; url?: string };
}) {
  for (const listener of [...tabUpdatedListeners]) {
    listener(1, input.changeInfo, input.tabInfo);
  }
}

function emitWindowFocusChanged() {
  for (const listener of [...windowFocusChangedListeners]) {
    listener();
  }
}

function makeModel(input: {
  id: string;
  connected: boolean;
}): RuntimeModelSummary {
  return {
    id: input.id,
    name: input.id,
    provider: input.id.split("/")[0] ?? "provider",
    capabilities: ["text"],
    connected: input.connected,
  };
}

function makePermission(input: {
  modelId: string;
  status: "allowed" | "denied" | "pending";
}): RuntimePermissionEntry {
  return {
    modelId: input.modelId,
    modelName: input.modelId,
    provider: input.modelId.split("/")[0] ?? "provider",
    status: input.status,
    capabilities: ["text"],
    requestedAt: 1,
  };
}

function makePendingRequest(input: {
  id: string;
  origin: string;
  modelId: string;
}): RuntimePendingRequest {
  return {
    id: input.id,
    origin: input.origin,
    modelId: input.modelId,
    modelName: input.modelId,
    provider: input.modelId.split("/")[0] ?? "provider",
    capabilities: ["text"],
    requestedAt: 1,
    dismissed: false,
    status: "pending",
  };
}

async function publishSnapshot<A>(pubsub: PubSub.PubSub<A>, value: A) {
  await Effect.runPromise(PubSub.publish(pubsub, value));
}

function makeCatalogLayer() {
  const catalog: CatalogServiceApi = {
    ensureCatalog: () => Effect.void,
    refreshCatalog: () => Effect.void,
    refreshCatalogForProvider: () => Effect.void,
    listProviders: () => Effect.succeed([]),
    streamProviders: () => Stream.empty,
    listModels: () => Effect.succeed([]),
    streamModels: () => Stream.fromPubSub(modelsPubSub),
  };

  return Layer.succeed(CatalogService, catalog);
}

function makePermissionsLayer() {
  const permissions: PermissionsServiceApi = {
    getOriginState: () => Effect.die("unused"),
    streamOriginState: () => Stream.empty,
    listPermissions: () => Effect.die("unused"),
    streamPermissions: () => Stream.empty,
    getModelPermission: () => Effect.die("unused"),
    setOriginEnabled: () => Effect.die("unused"),
    setModelPermission: () => Effect.die("unused"),
    createPermissionRequest: () => Effect.die("unused"),
    resolvePermissionRequest: () => Effect.die("unused"),
    dismissPermissionRequest: () => Effect.die("unused"),
    listPending: () => Effect.die("unused"),
    streamPending: () => Stream.empty,
    waitForPermissionDecision: () => Effect.die("unused"),
    streamOriginStates: () => Stream.fromPubSub(originStatesPubSub),
    streamPermissionsMap: () => Stream.fromPubSub(permissionsPubSub),
    streamPendingMap: () => Stream.fromPubSub(pendingPubSub),
  };

  return Layer.succeed(PermissionsService, permissions);
}

function makeRuntime() {
  return ManagedRuntime.make(
    Layer.mergeAll(makeCatalogLayer(), makePermissionsLayer()),
  );
}

function launchToolbarProjection() {
  const runtime = makeRuntime();
  const fiber = runtime.runFork(Layer.launch(ToolbarProjectionLive));

  return {
    runtime,
    fiber,
  };
}

async function stopToolbarProjection(input: {
  runtime: ManagedRuntime.ManagedRuntime<CatalogService | PermissionsService, never>;
  fiber: Fiber.RuntimeFiber<void, never>;
}) {
  await Effect.runPromise(Fiber.interrupt(input.fiber));
  await input.runtime.dispose();
}

function lastBadgeText() {
  return setBadgeTextMock.mock.calls.at(-1)?.[0]?.text;
}

function lastIconInput() {
  return setIconMock.mock.calls.at(-1)?.[0];
}

function lastIconRgb() {
  const input = lastIconInput();
  if (!input || !("imageData" in input)) {
    return null;
  }

  const imageData = input.imageData[16];
  if (!imageData) {
    return null;
  }

  return [imageData.data[0], imageData.data[1], imageData.data[2]];
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}

beforeEach(async () => {
  activeTabUrl = "https://example.test/page";
  shouldFailContext = false;

  tabActivatedListeners.clear();
  tabUpdatedListeners.clear();
  windowFocusChangedListeners.clear();

  setBadgeBackgroundColorMock.mockClear();
  setBadgeTextMock.mockClear();
  setIconMock.mockClear();
  queryTabsMock.mockClear();
  fetchMock.mockClear();
  createImageBitmapMock.mockClear();
  warnMock.mockClear();

  Reflect.set(globalThis, "fetch", (input: string) => fetchMock(input));
  Reflect.set(globalThis, "ImageData", FakeImageData);
  Reflect.set(globalThis, "createImageBitmap", (blob: Blob) =>
    createImageBitmapMock(blob),
  );
  Reflect.set(globalThis, "OffscreenCanvas", FakeOffscreenCanvas);
  Reflect.set(console, "warn", warnMock);

  modelsPubSub = await Effect.runPromise(
    PubSub.unbounded<ReadonlyArray<RuntimeModelSummary>>({
      replay: 1,
    }),
  );
  originStatesPubSub = await Effect.runPromise(
    PubSub.unbounded<ReadonlyMap<string, RuntimeOriginState>>({
      replay: 1,
    }),
  );
  permissionsPubSub = await Effect.runPromise(
    PubSub.unbounded<
      ReadonlyMap<string, ReadonlyArray<RuntimePermissionEntry>>
    >({
      replay: 1,
    }),
  );
  pendingPubSub = await Effect.runPromise(
    PubSub.unbounded<
      ReadonlyMap<string, ReadonlyArray<RuntimePendingRequest>>
    >({
      replay: 1,
    }),
  );
});

afterAll(() => {
  Reflect.set(globalThis, "fetch", originalFetch);
  Reflect.set(globalThis, "ImageData", originalImageData);
  Reflect.set(globalThis, "createImageBitmap", originalCreateImageBitmap);
  Reflect.set(globalThis, "OffscreenCanvas", originalOffscreenCanvas);
  Reflect.set(console, "warn", originalConsoleWarn);
  mock.restore();
});

describe("ToolbarProjectionLive", () => {
  it("sets the initial badge count and inactive icon from streamed state", async () => {
    await publishSnapshot(modelsPubSub, []);
    await publishSnapshot(
      originStatesPubSub,
      new Map([
        [
          "https://example.test",
          {
            origin: "https://example.test",
            enabled: true,
          },
        ],
      ]),
    );
    await publishSnapshot(
      permissionsPubSub,
      new Map([
        [
          "https://example.test",
          [
            makePermission({
              modelId: "openai/gpt-4o-mini",
              status: "allowed",
            }),
          ],
        ],
      ]),
    );
    await publishSnapshot(
      pendingPubSub,
      new Map([
        [
          "https://example.test",
          [
            makePendingRequest({
              id: "pending-1",
              origin: "https://example.test",
              modelId: "openai/gpt-4o-mini",
            }),
          ],
        ],
      ]),
    );

    const launched = launchToolbarProjection();

    try {
      await waitFor(
        () =>
          lastBadgeText() === "1" &&
          JSON.stringify(lastIconRgb()) === JSON.stringify(INACTIVE_ICON_RGB),
      );

      expect(setBadgeBackgroundColorMock.mock.calls.at(-1)?.[0]).toEqual({
        color: "#d97706",
      });
      expect(lastBadgeText()).toBe("1");
      expect(lastIconRgb()).toEqual(INACTIVE_ICON_RGB);
    } finally {
      await stopToolbarProjection(launched);
    }
  });

  it("recomputes badge and icon state when the model, origin, permission, and pending streams change", async () => {
    await publishSnapshot(modelsPubSub, []);
    await publishSnapshot(
      originStatesPubSub,
      new Map([
        [
          "https://example.test",
          {
            origin: "https://example.test",
            enabled: false,
          },
        ],
      ]),
    );
    await publishSnapshot(
      permissionsPubSub,
      new Map<string, ReadonlyArray<RuntimePermissionEntry>>(),
    );
    await publishSnapshot(
      pendingPubSub,
      new Map([
        [
          "https://example.test",
          [
            makePendingRequest({
              id: "pending-1",
              origin: "https://example.test",
              modelId: "openai/gpt-4o-mini",
            }),
          ],
        ],
      ]),
    );

    const launched = launchToolbarProjection();

    try {
      await waitFor(
        () =>
          lastBadgeText() === "1" &&
          JSON.stringify(lastIconRgb()) === JSON.stringify(INACTIVE_ICON_RGB),
      );

      await publishSnapshot(
        originStatesPubSub,
        new Map([
          [
            "https://example.test",
            {
              origin: "https://example.test",
              enabled: true,
            },
          ],
        ]),
      );
      await publishSnapshot(
        permissionsPubSub,
        new Map([
          [
            "https://example.test",
            [
              makePermission({
                modelId: "openai/gpt-4o-mini",
                status: "allowed",
              }),
            ],
          ],
        ]),
      );
      await publishSnapshot(
        modelsPubSub,
        [
          makeModel({
            id: "openai/gpt-4o-mini",
            connected: true,
          }),
        ],
      );
      await publishSnapshot(
        pendingPubSub,
        new Map([
          [
            "https://example.test",
            [
              makePendingRequest({
                id: "pending-1",
                origin: "https://example.test",
                modelId: "openai/gpt-4o-mini",
              }),
              makePendingRequest({
                id: "pending-2",
                origin: "https://example.test",
                modelId: "openai/gpt-4o-mini",
              }),
            ],
          ],
        ]),
      );

      await waitFor(
        () =>
          lastBadgeText() === "2" &&
          JSON.stringify(lastIconRgb()) === JSON.stringify(ACTIVE_ICON_RGB),
      );

      expect(lastBadgeText()).toBe("2");
      expect(lastIconRgb()).toEqual(ACTIVE_ICON_RGB);
    } finally {
      await stopToolbarProjection(launched);
    }
  });

  it("recomputes when browser tab and window listeners fire", async () => {
    await publishSnapshot(
      modelsPubSub,
      [
        makeModel({
          id: "openai/gpt-4o-mini",
          connected: true,
        }),
      ],
    );
    await publishSnapshot(
      originStatesPubSub,
      new Map([
        [
          "https://example.test",
          {
            origin: "https://example.test",
            enabled: true,
          },
        ],
      ]),
    );
    await publishSnapshot(
      permissionsPubSub,
      new Map([
        [
          "https://example.test",
          [
            makePermission({
              modelId: "openai/gpt-4o-mini",
              status: "allowed",
            }),
          ],
        ],
      ]),
    );
    await publishSnapshot(
      pendingPubSub,
      new Map<string, ReadonlyArray<RuntimePendingRequest>>(),
    );

    const launched = launchToolbarProjection();

    try {
      await waitFor(
        () =>
          lastBadgeText() === "" &&
          JSON.stringify(lastIconRgb()) === JSON.stringify(ACTIVE_ICON_RGB),
      );

      activeTabUrl = "https://other.test/page";
      emitTabActivated();

      await waitFor(
        () => JSON.stringify(lastIconRgb()) === JSON.stringify(INACTIVE_ICON_RGB),
      );

      activeTabUrl = "https://example.test/updated";
      emitTabUpdated({
        changeInfo: {
          status: "complete",
        },
        tabInfo: {
          active: true,
          url: activeTabUrl,
        },
      });

      await waitFor(
        () => JSON.stringify(lastIconRgb()) === JSON.stringify(ACTIVE_ICON_RGB),
      );

      activeTabUrl = "https://other.test/focused";
      emitWindowFocusChanged();

      await waitFor(
        () => JSON.stringify(lastIconRgb()) === JSON.stringify(INACTIVE_ICON_RGB),
      );
    } finally {
      await stopToolbarProjection(launched);
    }
  });

  it("warns and falls back to the static icon path when icon rendering fails", async () => {
    shouldFailContext = true;

    await publishSnapshot(
      modelsPubSub,
      [
        makeModel({
          id: "openai/gpt-4o-mini",
          connected: true,
        }),
      ],
    );
    await publishSnapshot(
      originStatesPubSub,
      new Map([
        [
          "https://example.test",
          {
            origin: "https://example.test",
            enabled: true,
          },
        ],
      ]),
    );
    await publishSnapshot(
      permissionsPubSub,
      new Map([
        [
          "https://example.test",
          [
            makePermission({
              modelId: "openai/gpt-4o-mini",
              status: "allowed",
            }),
          ],
        ],
      ]),
    );
    await publishSnapshot(
      pendingPubSub,
      new Map<string, ReadonlyArray<RuntimePendingRequest>>(),
    );

    const launched = launchToolbarProjection();

    try {
      await waitFor(
        () =>
          setIconMock.mock.calls.length > 0 &&
          lastIconInput() != null &&
          "path" in lastIconInput()!,
      );

      expect(warnMock.mock.calls).toHaveLength(1);
      expect(warnMock.mock.calls[0]?.[0]).toBe("toolbar icon update failed");
      expect(lastIconInput()).toEqual({
        path: {
          16: "/icon-32x32.png",
          32: "/icon-32x32.png",
        },
      });
    } finally {
      await stopToolbarProjection(launched);
    }
  });

  it("removes browser listeners when the layer scope closes", async () => {
    await publishSnapshot(modelsPubSub, []);
    await publishSnapshot(
      originStatesPubSub,
      new Map<string, RuntimeOriginState>(),
    );
    await publishSnapshot(
      permissionsPubSub,
      new Map<string, ReadonlyArray<RuntimePermissionEntry>>(),
    );
    await publishSnapshot(
      pendingPubSub,
      new Map<string, ReadonlyArray<RuntimePendingRequest>>(),
    );

    const launched = launchToolbarProjection();

    try {
      await waitFor(
        () =>
          tabActivatedListeners.size === 1 &&
          tabUpdatedListeners.size === 1 &&
          windowFocusChangedListeners.size === 1,
      );
    } finally {
      await stopToolbarProjection(launched);
    }

    expect(tabActivatedListeners.size).toBe(0);
    expect(tabUpdatedListeners.size).toBe(0);
    expect(windowFocusChangedListeners.size).toBe(0);
  });
});
