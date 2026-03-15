import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  RuntimeValidationError,
  type RuntimeAuthFlowSnapshot,
  type RuntimeAuthFlowInstruction,
} from "@llm-bridge/contracts";
import {
  AuthFlowService,
  CatalogService,
  type AppRuntime,
  type CatalogServiceApi,
} from "@llm-bridge/runtime-core";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import type { RuntimeAuthMethod } from "@/background/runtime/providers/adapters/types";
import { makeUnusedRuntimeLayer } from "@/background/test-utils/runtime-service-stubs";

const authMethods: ReadonlyArray<RuntimeAuthMethod> = [
  {
    id: "oauth",
    type: "oauth",
    label: "OAuth",
    fields: [],
  },
];

const windowRemovedListeners = new Set<(windowId: number) => void>();
let nextWindowId = 101;
const createWindowMock = mock(async () => ({
  id: nextWindowId++,
}));
const updateWindowMock = mock(async (windowId: number) => ({
  id: windowId,
}));

mock.module("@wxt-dev/browser", () => ({
  browser: {
    runtime: {
      getURL: (path: string) => `chrome-extension://test${path}`,
    },
    windows: {
      create: createWindowMock,
      update: updateWindowMock,
      onRemoved: {
        addListener(listener: (windowId: number) => void) {
          windowRemovedListeners.add(listener);
        },
        removeListener(listener: (windowId: number) => void) {
          windowRemovedListeners.delete(listener);
        },
      },
    },
  },
}));

let refreshCalls: string[] = [];
let disconnectCalls: string[] = [];
let startProviderAuthImpl: (input: {
  providerID: string;
  methodID: string;
  values?: Record<string, string>;
  signal?: AbortSignal;
  onInstruction?: (
    instruction: RuntimeAuthFlowInstruction,
  ) => Effect.Effect<void>;
}) => Effect.Effect<{ methodID: string; connected: true }, unknown> = (input) =>
  Effect.succeed({
    methodID: input.methodID,
    connected: true as const,
  });

mock.module("@/background/runtime/auth/provider-auth", () => ({
  listProviderAuthMethods: () => Effect.succeed(authMethods),
  startProviderAuth: (input: Parameters<typeof startProviderAuthImpl>[0]) =>
    startProviderAuthImpl(input),
  disconnectProvider: (providerID: string) =>
    Effect.sync(() => {
      disconnectCalls.push(providerID);
    }),
}));

const { AuthFlowServiceLive } = await import("./auth-flow-service");

function emitWindowRemoved(windowId: number) {
  for (const listener of [...windowRemovedListeners]) {
    listener(windowId);
  }
}

function waitForPromise<A>(promise: Promise<A>) {
  return Effect.tryPromise({
    try: () => promise,
    catch: (error) => error,
  });
}

function makeCatalogLayer() {
  const catalog: CatalogServiceApi = {
    ensureCatalog: () => Effect.void,
    refreshCatalog: () => Effect.void,
    refreshCatalogForProvider: (providerID: string) =>
      Effect.sync(() => {
        refreshCalls.push(providerID);
      }),
    listProviders: () => Effect.succeed([]),
    streamProviders: () => Stream.empty,
    listModels: () => Effect.succeed([]),
    streamModels: () => Stream.empty,
  };

  return Layer.succeed(CatalogService, catalog);
}

function makeRuntimeLayer(): Layer.Layer<AppRuntime, unknown, never> {
  const catalogLayer = makeCatalogLayer();
  const authFlowLayer = AuthFlowServiceLive.pipe(Layer.provide(catalogLayer));
  const liveLayer = Layer.merge(catalogLayer, authFlowLayer);
  const stubsLayer = makeUnusedRuntimeLayer({
    omit: ["catalog", "authFlow"] as const,
  }).pipe(Layer.provide(liveLayer));

  return Layer.merge(
    liveLayer,
    stubsLayer,
  );
}

function runWithService<A, E>(
  effect: Effect.Effect<A, E, AppRuntime>,
) {
  const runtime = ManagedRuntime.make(makeRuntimeLayer());

  return runtime.runPromise(effect).finally(() => runtime.dispose());
}

function makeBlockingStartAuth() {
  let aborted = false;
  let interrupted = false;
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });

  startProviderAuthImpl = (input) => {
    const onAbort = () => {
      aborted = true;
    };

    return Effect.async<never>(() => {
      input.signal?.addEventListener("abort", onAbort, { once: true });
      resolveStarted();

      return Effect.sync(() => {
        input.signal?.removeEventListener("abort", onAbort);
      });
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        }),
      ),
    );
  };

  return {
    started,
    getAborted: () => aborted,
    getInterrupted: () => interrupted,
  };
}

beforeEach(() => {
  refreshCalls = [];
  disconnectCalls = [];
  nextWindowId = 101;
  windowRemovedListeners.clear();
  createWindowMock.mockClear();
  updateWindowMock.mockClear();
  startProviderAuthImpl = (input) =>
    Effect.succeed({
      methodID: input.methodID,
      connected: true as const,
    });
});

afterAll(() => {
  mock.restore();
});

describe("auth-flow-service", () => {
  it("streams idle, authorizing, and success while publishing instructions", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const authFlow = yield* AuthFlowService;
        let releaseAuth!: () => void;
        const authReleased = new Promise<void>((resolve) => {
          releaseAuth = resolve;
        });
        let resolveStarted!: () => void;
        const authStarted = new Promise<void>((resolve) => {
          resolveStarted = resolve;
        });
        let resolveInitial!: () => void;
        const initialSeen = new Promise<void>((resolve) => {
          resolveInitial = resolve;
        });

        startProviderAuthImpl = (input) =>
          Effect.gen(function* () {
            yield* input.onInstruction?.({
              kind: "notice",
              title: "Continue in browser",
              message: "Finish signing in.",
              url: "https://example.test/auth",
              autoOpened: true,
            }) ?? Effect.void;
            resolveStarted();
            yield* waitForPromise(authReleased);
            return {
              methodID: input.methodID,
              connected: true as const,
            };
          });

        const snapshots: Array<{
          providerID: string;
          result: RuntimeAuthFlowSnapshot;
        }> = [];

        const streamFiber = yield* Effect.fork(
          authFlow.streamProviderAuthFlow("openai").pipe(
            Stream.take(4),
            Stream.runForEach((entry) =>
              Effect.sync(() => {
                snapshots.push(entry);
                if (snapshots.length === 1) {
                  resolveInitial();
                }
              }),
            ),
          ),
        );

        yield* waitForPromise(initialSeen);

        const startFiber = yield* Effect.fork(
          authFlow.startProviderAuthFlow({
            providerID: "openai",
            methodID: "oauth",
          }),
        );

        yield* waitForPromise(authStarted);
        releaseAuth();

        yield* Fiber.join(streamFiber);
        const response = yield* Fiber.join(startFiber);

        return {
          snapshots,
          response,
        };
      }),
    );

    expect(result.snapshots.map((entry) => entry.result.status)).toEqual([
      "idle",
      "authorizing",
      "authorizing",
      "success",
    ]);
    expect(result.snapshots[2]?.result.instruction).toEqual({
      kind: "notice",
      title: "Continue in browser",
      message: "Finish signing in.",
      url: "https://example.test/auth",
      autoOpened: true,
    });
    expect(result.response.result.status).toBe("success");
    expect(refreshCalls).toEqual(["openai"]);
  });

  it("surfaces typed provider-auth failures as error snapshots", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const authFlow = yield* AuthFlowService;

        startProviderAuthImpl = () =>
          Effect.fail(
            new RuntimeValidationError({
              message: "Invalid provider input",
            }),
          );

        const response = yield* authFlow.startProviderAuthFlow({
          providerID: "openai",
          methodID: "oauth",
        });
        const latest = yield* authFlow.getProviderAuthFlow("openai");

        return {
          response,
          latest,
        };
      }),
    );

    expect(result.response.result.status).toBe("error");
    expect(result.response.result.error).toBe("Invalid provider input");
    expect(result.latest.result.status).toBe("error");
    expect(result.latest.result.error).toBe("Invalid provider input");
  });

  it("cancels active auth work and returns a canceled snapshot", async () => {
    const blocking = makeBlockingStartAuth();

    const result = await runWithService(
      Effect.gen(function* () {
        const authFlow = yield* AuthFlowService;
        const startFiber = yield* Effect.fork(
          authFlow.startProviderAuthFlow({
            providerID: "openai",
            methodID: "oauth",
          }),
        );

        yield* waitForPromise(blocking.started);

        const canceled = yield* authFlow.cancelProviderAuthFlow({
          providerID: "openai",
        });
        const response = yield* Fiber.join(startFiber);

        return {
          canceled,
          response,
        };
      }),
    );

    expect(blocking.getAborted()).toBe(true);
    expect(result.canceled.result.status).toBe("canceled");
    expect(result.response.result.status).toBe("canceled");
    expect(result.response.result.error).toBe("Authentication canceled.");
  });

  it("cancels an active flow when the auth window closes and drops the window reference", async () => {
    const blocking = makeBlockingStartAuth();

    const result = await runWithService(
      Effect.gen(function* () {
        const authFlow = yield* AuthFlowService;
        const opened = yield* authFlow.openProviderAuthWindow("openai");
        const startFiber = yield* Effect.fork(
          authFlow.startProviderAuthFlow({
            providerID: "openai",
            methodID: "oauth",
          }),
        );

        yield* waitForPromise(blocking.started);
        emitWindowRemoved(opened.windowId);
        yield* Effect.sleep("10 millis");

        const reopened = yield* authFlow.openProviderAuthWindow("openai");
        const response = yield* Fiber.join(startFiber);

        return {
          opened,
          reopened,
          response,
        };
      }),
    );

    expect(blocking.getAborted()).toBe(true);
    expect(result.response.result.status).toBe("canceled");
    expect(result.reopened.reused).toBe(false);
    expect(result.reopened.windowId).not.toBe(result.opened.windowId);
  });

  it("disconnects a provider, interrupts active auth work, and resets the flow to idle", async () => {
    const blocking = makeBlockingStartAuth();

    const result = await runWithService(
      Effect.gen(function* () {
        const authFlow = yield* AuthFlowService;
        const startFiber = yield* Effect.fork(
          authFlow.startProviderAuthFlow({
            providerID: "openai",
            methodID: "oauth",
          }),
        );

        yield* waitForPromise(blocking.started);

        const disconnected = yield* authFlow.disconnectProvider("openai");
        const current = yield* authFlow.getProviderAuthFlow("openai");
        const response = yield* Fiber.join(startFiber);

        return {
          disconnected,
          current,
          response,
        };
      }),
    );

    expect(blocking.getAborted()).toBe(true);
    expect(result.disconnected).toEqual({
      providerID: "openai",
      connected: false,
    });
    expect(result.current.result.status).toBe("idle");
    expect(result.response.result.status).toBe("idle");
    expect(disconnectCalls).toEqual(["openai"]);
    expect(refreshCalls).toEqual(["openai"]);
  });

  it("interrupts in-flight auth work when the service scope closes", async () => {
    const blocking = makeBlockingStartAuth();

    const runtime = ManagedRuntime.make(makeRuntimeLayer());

    try {
      await runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const authFlow = yield* AuthFlowService;

            yield* authFlow.openProviderAuthWindow("openai");
            yield* authFlow
              .startProviderAuthFlow({
                providerID: "openai",
                methodID: "oauth",
              })
              .pipe(Effect.catchAll(() => Effect.void), Effect.forkScoped);

            yield* waitForPromise(blocking.started);
          }),
        ),
      );
    } finally {
      await runtime.dispose();
    }

    expect(blocking.getInterrupted()).toBe(true);
  });
});
