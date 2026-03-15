import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mock } from "@/test-utils/vitest-compat";
import { CatalogService, type AppRuntime } from "@llm-bridge/runtime-core";
import type { RuntimeProviderSummary } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { makeUnusedRuntimeLayer } from "@/background/test-utils/runtime-service-stubs";
import { waitForCondition } from "@/background/test-utils/wait-for";

type ProviderRow = {
  id: string;
  name: string;
  connected: boolean;
  env: ReadonlyArray<string>;
  modelCount: number;
};

type ModelRow = {
  id: string;
  providerID: string;
  capabilities: ReadonlyArray<string>;
  info: {
    name: string;
  };
};

let providerRows: Array<ProviderRow> = [];
let modelRows: Array<ModelRow> = [];

mock.module("@/background/runtime/catalog/provider-registry-query", () => ({
  listProviderRows: () => Effect.succeed(providerRows),
  listModelRows: () => Effect.succeed(modelRows),
}));

mock.module("@/background/runtime/catalog/provider-registry-refresh", () => ({
  ensureProviderCatalog: () => Effect.void,
  refreshProviderCatalog: () => Effect.void,
  refreshProviderCatalogForProvider: () => Effect.void,
}));

const { CatalogServiceLive } = await import("./catalog-service");

function makeRuntime(): ManagedRuntime.ManagedRuntime<AppRuntime, unknown> {
  const liveLayer = CatalogServiceLive;
  const stubsLayer = makeUnusedRuntimeLayer({
    omit: ["catalog"] as const,
  }).pipe(Layer.provide(liveLayer));

  return ManagedRuntime.make(Layer.merge(liveLayer, stubsLayer));
}

async function getCatalogService(
  runtime: ReturnType<typeof makeRuntime>,
) {
  return runtime.runPromise(Effect.gen(function* () {
    return yield* CatalogService;
  }));
}

describe("CatalogServiceLive", () => {
  beforeEach(() => {
    providerRows = [
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        env: ["oauth"],
        modelCount: 1,
      },
    ];
    modelRows = [
      {
        id: "openai/gpt-5",
        providerID: "openai",
        capabilities: ["text"],
        info: {
          name: "GPT-5",
        },
      },
    ];
  });

  afterEach(async () => {
    providerRows = [];
    modelRows = [];
  });

  it("emits initial providers and later updates from the canonical snapshot", async () => {
    const runtime = makeRuntime();
    const service = await getCatalogService(runtime);
    const updates: Array<ReadonlyArray<RuntimeProviderSummary>> = [];

    const fiber = runtime.runFork(
      Effect.scoped(
        service.streamProviders().pipe(
          Stream.runForEach((providers) =>
            Effect.sync(() => {
              updates.push(providers);
            }),
          ),
        ),
      ),
    );

    await waitForCondition(() => updates.length === 1);

    providerRows = [
      ...providerRows,
      {
        id: "anthropic",
        name: "Anthropic",
        connected: false,
        env: ["apiKey"],
        modelCount: 1,
      },
    ];
    modelRows = [
      ...modelRows,
      {
        id: "anthropic/claude-3.7",
        providerID: "anthropic",
        capabilities: ["text"],
        info: {
          name: "Claude 3.7",
        },
      },
    ];

    await runtime.runPromise(service.refreshCatalog());
    await waitForCondition(() => updates.length === 2);

    expect(updates[0]).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        env: ["oauth"],
        modelCount: 1,
      },
    ]);
    expect(updates[1]).toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        connected: false,
        env: ["apiKey"],
        modelCount: 1,
      },
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        env: ["oauth"],
        modelCount: 1,
      },
    ]);

    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.dispose();
  });

  it("does not emit duplicate provider snapshots when refresh results are unchanged", async () => {
    const runtime = makeRuntime();
    const service = await getCatalogService(runtime);
    const updates: Array<ReadonlyArray<unknown>> = [];

    const fiber = runtime.runFork(
      Effect.scoped(
        service.streamProviders().pipe(
          Stream.runForEach((providers) =>
            Effect.sync(() => {
              updates.push(providers);
            }),
          ),
        ),
      ),
    );

    await waitForCondition(() => updates.length === 1);
    await runtime.runPromise(service.refreshCatalog());
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(updates).toHaveLength(1);

    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.dispose();
  });

  it("keeps filtered model streams stable when unrelated snapshot fields change", async () => {
    const runtime = makeRuntime();
    const service = await getCatalogService(runtime);
    const updates: Array<ReadonlyArray<unknown>> = [];

    const fiber = runtime.runFork(
      Effect.scoped(
        service
          .streamModels({
            connectedOnly: true,
          })
          .pipe(
            Stream.runForEach((models) =>
              Effect.sync(() => {
                updates.push(models);
              }),
            ),
          ),
      ),
    );

    await waitForCondition(() => updates.length === 1);

    providerRows = [
      {
        id: "openai",
        name: "OpenAI",
        connected: true,
        env: ["oauth"],
        modelCount: 2,
      },
      {
        id: "anthropic",
        name: "Anthropic",
        connected: false,
        env: ["apiKey"],
        modelCount: 1,
      },
    ];
    modelRows = [
      ...modelRows,
      {
        id: "anthropic/claude-3.7",
        providerID: "anthropic",
        capabilities: ["text"],
        info: {
          name: "Claude 3.7",
        },
      },
    ];

    await runtime.runPromise(service.refreshCatalog());
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(updates).toHaveLength(1);

    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.dispose();
  });
});
