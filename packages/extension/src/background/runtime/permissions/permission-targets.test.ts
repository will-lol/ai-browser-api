import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mock } from "@/test-utils/vitest-compat";
import * as Effect from "effect/Effect";

const CONNECTED_MODEL_ID = "openai/gpt-4o-mini";
const DISCONNECTED_MODEL_ID = "anthropic/claude-sonnet";
const MISSING_MODEL_ID = "missing/model";

const modelRowsById = new Map<
  string,
  {
    id: string;
    providerID: string;
    capabilities: string[];
    info: {
      name: string;
    };
  }
>();

const providerRowsById = new Map<
  string,
  {
    id: string;
    connected: boolean;
  }
>();

const modelsBulkGetMock = mock(async (modelIds: string[]) =>
  modelIds.map((modelId) => modelRowsById.get(modelId)),
);

const providersBulkGetMock = mock(async (providerIds: string[]) =>
  providerIds.map((providerId) => providerRowsById.get(providerId)),
);

mock.module("@/background/storage/runtime-db", () => ({
  runtimeDb: {
    models: {
      bulkGet: modelsBulkGetMock,
    },
    providers: {
      bulkGet: providersBulkGetMock,
    },
  },
}));

const { resolveTrustedPermissionTarget } = await import("./permission-targets");

beforeEach(() => {
  modelRowsById.clear();
  providerRowsById.clear();
  modelsBulkGetMock.mockClear();
  providersBulkGetMock.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("permission target resolution", () => {
  it("resolves connected models as trusted permission targets", async () => {
    modelRowsById.set(CONNECTED_MODEL_ID, {
      id: CONNECTED_MODEL_ID,
      providerID: "openai",
      capabilities: ["text", "code"],
      info: {
        name: "GPT-4o mini",
      },
    });
    providerRowsById.set("openai", {
      id: "openai",
      connected: true,
    });

    await expect(
      Effect.runPromise(resolveTrustedPermissionTarget(CONNECTED_MODEL_ID)),
    ).resolves.toEqual({
      status: "resolved",
      target: {
        modelId: CONNECTED_MODEL_ID,
        modelName: "GPT-4o mini",
        provider: "openai",
        capabilities: ["text", "code"],
      },
    });
  });

  it("marks missing models as missing", async () => {
    await expect(
      Effect.runPromise(resolveTrustedPermissionTarget(MISSING_MODEL_ID)),
    ).resolves.toEqual({
      status: "missing",
      modelId: MISSING_MODEL_ID,
    });
  });

  it("marks disconnected providers as disconnected", async () => {
    modelRowsById.set(DISCONNECTED_MODEL_ID, {
      id: DISCONNECTED_MODEL_ID,
      providerID: "anthropic",
      capabilities: ["text"],
      info: {
        name: "Claude Sonnet",
      },
    });
    providerRowsById.set("anthropic", {
      id: "anthropic",
      connected: false,
    });

    await expect(
      Effect.runPromise(resolveTrustedPermissionTarget(DISCONNECTED_MODEL_ID)),
    ).resolves.toEqual({
      status: "disconnected",
      modelId: DISCONNECTED_MODEL_ID,
      provider: "anthropic",
    });
  });

  it("treats models with missing providers as missing", async () => {
    modelRowsById.set(CONNECTED_MODEL_ID, {
      id: CONNECTED_MODEL_ID,
      providerID: "openai",
      capabilities: ["text", "code"],
      info: {
        name: "GPT-4o mini",
      },
    });

    await expect(
      Effect.runPromise(resolveTrustedPermissionTarget(CONNECTED_MODEL_ID)),
    ).resolves.toEqual({
      status: "missing",
      modelId: CONNECTED_MODEL_ID,
    });
  });

  it("leaves bulk-get read failures unnormalized on the live permission-target path", async () => {
    modelsBulkGetMock.mockImplementationOnce(async () => {
      throw new Error("db unavailable");
    });

    await expect(
      Effect.runPromise(resolveTrustedPermissionTarget(CONNECTED_MODEL_ID)),
    ).rejects.toThrow(/db unavailable/);
  });
});
