import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { RuntimeInternalError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import type {
  RuntimeDbModel,
  RuntimeDbProvider,
} from "@/background/storage/runtime-db-types";
import { runtimeModelKey } from "@/background/storage/runtime-db-types";

const providerRowsById = new Map<string, RuntimeDbProvider>();
const modelRowsById = new Map<string, RuntimeDbModel>();

const ensureProviderCatalogMock = mock(() => Effect.void);
const providersToArrayMock = mock(async () => Array.from(providerRowsById.values()));
const providersGetMock = mock(async (providerId: string) =>
  providerRowsById.get(providerId),
);
const modelsToArrayMock = mock(async () => Array.from(modelRowsById.values()));
const modelsGetMock = mock(async (id: string) => modelRowsById.get(id));
const modelsWhereMock = mock((_field: string) => ({
  equals: (providerId: string) => ({
    toArray: async () =>
      Array.from(modelRowsById.values()).filter(
        (row) => row.providerID === providerId,
      ),
  }),
  anyOf: (providerIds: string[]) => ({
    toArray: async () =>
      Array.from(modelRowsById.values()).filter((row) =>
        providerIds.includes(row.providerID),
      ),
  }),
}));

mock.module("@/background/storage/runtime-db", () => ({
  runtimeDb: {
    providers: {
      toArray: providersToArrayMock,
      get: providersGetMock,
    },
    models: {
      toArray: modelsToArrayMock,
      get: modelsGetMock,
      where: modelsWhereMock,
    },
  },
}));

mock.module("./provider-registry-refresh", () => ({
  ensureProviderCatalog: ensureProviderCatalogMock,
}));

const {
  getModel,
  getProvider,
  listModelRows,
  listProviderRows,
} = await import("./provider-registry-query");
const { serializeRpcError } = await import("@/background/rpc/runtime-rpc-handlers");

function createProviderRow(
  providerId: string,
  overrides: Partial<RuntimeDbProvider> = {},
): RuntimeDbProvider {
  return {
    id: providerId,
    name: providerId.toUpperCase(),
    source: "models.dev",
    env: [],
    connected: false,
    options: {},
    modelCount: 0,
    updatedAt: 1,
    ...overrides,
  };
}

function createModelRow(
  providerId: string,
  modelId: string,
  overrides: Partial<RuntimeDbModel> = {},
): RuntimeDbModel {
  return {
    id: runtimeModelKey(providerId, modelId),
    providerID: providerId,
    capabilities: ["text"],
    info: {
      id: modelId,
      providerID: providerId,
      name: `${providerId}/${modelId}`,
      status: "active",
      api: {
        id: `${providerId}-${modelId}`,
        url: "https://example.test/models",
        npm: "@example/sdk",
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      limit: {
        context: 128_000,
        output: 4_096,
      },
      options: {},
      headers: {},
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: false,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    },
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  providerRowsById.clear();
  modelRowsById.clear();

  ensureProviderCatalogMock.mockReset();
  ensureProviderCatalogMock.mockImplementation(() => Effect.void);

  providersToArrayMock.mockReset();
  providersToArrayMock.mockImplementation(async () =>
    Array.from(providerRowsById.values()),
  );

  providersGetMock.mockReset();
  providersGetMock.mockImplementation(async (providerId: string) =>
    providerRowsById.get(providerId),
  );

  modelsToArrayMock.mockReset();
  modelsToArrayMock.mockImplementation(async () => Array.from(modelRowsById.values()));

  modelsGetMock.mockReset();
  modelsGetMock.mockImplementation(async (id: string) => modelRowsById.get(id));

  modelsWhereMock.mockReset();
  modelsWhereMock.mockImplementation((_field: string) => ({
    equals: (providerId: string) => ({
      toArray: async () =>
        Array.from(modelRowsById.values()).filter(
          (row) => row.providerID === providerId,
        ),
    }),
    anyOf: (providerIds: string[]) => ({
      toArray: async () =>
        Array.from(modelRowsById.values()).filter((row) =>
          providerIds.includes(row.providerID),
        ),
    }),
  }));
});

afterAll(() => {
  mock.restore();
});

describe("provider-registry-query", () => {
  it("lists provider rows after ensuring the provider catalog", async () => {
    providerRowsById.set(
      "openai",
      createProviderRow("openai", {
        name: "OpenAI",
        connected: true,
        modelCount: 2,
      }),
    );
    providerRowsById.set(
      "anthropic",
      createProviderRow("anthropic", {
        name: "Anthropic",
      }),
    );

    const result = await Effect.runPromise(listProviderRows());

    expect(result).toEqual(Array.from(providerRowsById.values()));
    expect(ensureProviderCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("filters model rows by provider id", async () => {
    const openAiModelRow = createModelRow("openai", "gpt-4o-mini");
    const anthropicModelRow = createModelRow("anthropic", "claude-sonnet");
    modelRowsById.set(openAiModelRow.id, openAiModelRow);
    modelRowsById.set(anthropicModelRow.id, anthropicModelRow);

    const result = await Effect.runPromise(
      listModelRows({
        providerID: "openai",
      }),
    );

    expect(result).toEqual([openAiModelRow]);
    expect(ensureProviderCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("filters model rows to connected providers only", async () => {
    providerRowsById.set(
      "openai",
      createProviderRow("openai", {
        connected: true,
      }),
    );
    providerRowsById.set(
      "anthropic",
      createProviderRow("anthropic", {
        connected: false,
      }),
    );
    const openAiModelRow = createModelRow("openai", "gpt-4o-mini");
    const anthropicModelRow = createModelRow("anthropic", "claude-sonnet");
    modelRowsById.set(openAiModelRow.id, openAiModelRow);
    modelRowsById.set(anthropicModelRow.id, anthropicModelRow);

    const result = await Effect.runPromise(
      listModelRows({
        connectedOnly: true,
      }),
    );

    expect(result).toEqual([openAiModelRow]);
    expect(ensureProviderCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("returns mapped provider runtime info for a specific provider", async () => {
    providerRowsById.set(
      "openai",
      createProviderRow("openai", {
        name: "OpenAI",
        connected: true,
        env: ["OPENAI_API_KEY"],
        options: {
          region: "us",
        },
      }),
    );

    const result = await Effect.runPromise(getProvider("openai"));

    expect(result).toEqual({
      id: "openai",
      name: "OpenAI",
      source: "models.dev",
      env: ["OPENAI_API_KEY"],
      connected: true,
      options: {
        region: "us",
      },
    });
    expect(ensureProviderCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("returns model info for a specific provider/model pair", async () => {
    const modelRow = createModelRow("openai", "gpt-4o-mini", {
      info: {
        ...createModelRow("openai", "gpt-4o-mini").info,
        name: "GPT-4o mini",
      },
    });
    modelRowsById.set(modelRow.id, modelRow);

    const result = await Effect.runPromise(getModel("openai", "gpt-4o-mini"));

    expect(result).toEqual(modelRow.info);
    expect(ensureProviderCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("leaves catalog read failures unnormalized until the rpc boundary", async () => {
    providersToArrayMock.mockImplementation(async () => {
      throw new Error("db unavailable");
    });

    await expect(Effect.runPromise(listProviderRows())).rejects.toThrow(
      /db unavailable/,
    );

    const result = await Effect.runPromise(
      Effect.either(serializeRpcError(listProviderRows())),
    );

    expect("left" in result).toBe(true);
    if ("left" in result) {
      expect(result.left).toEqual(
        new RuntimeInternalError({
          operation: "runtime.rpc",
          message: "db unavailable",
        }),
      );
    }
  });
});
