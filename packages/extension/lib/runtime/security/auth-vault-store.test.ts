import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";

const authRows = new Map<
  string,
  {
    providerID: string;
    recordType: "api" | "oauth";
    version: number;
    iv: Uint8Array;
    ciphertext: ArrayBuffer;
    createdAt: number;
    updatedAt: number;
  }
>();

const providerRows = new Map<
  string,
  {
    id: string;
    name: string;
    source: "models.dev";
    env: string[];
    connected: boolean;
    options: Record<string, unknown>;
    modelCount: number;
    updatedAt: number;
  }
>();

const vaultKeyRows = new Map<
  string,
  {
    id: "auth-master-key";
    key: CryptoKey;
    algorithm: "AES-GCM";
    version: number;
    createdAt: number;
    updatedAt: number;
  }
>();

const publishedEvents: Array<{
  type: string;
  payload: unknown;
}> = [];

let afterCommitEffects: Array<() => unknown | Promise<unknown>> = [];
let nowValue = 100;

mock.module("@/lib/runtime/db/runtime-db", () => ({
  runtimeDb: {
    auth: {
      get: async (providerID: string) => authRows.get(providerID),
      put: async (row: {
        providerID: string;
        recordType: "api" | "oauth";
        version: number;
        iv: Uint8Array;
        ciphertext: ArrayBuffer;
        createdAt: number;
        updatedAt: number;
      }) => {
        authRows.set(row.providerID, row);
      },
      delete: async (providerID: string) => {
        authRows.delete(providerID);
      },
      toArray: async () => Array.from(authRows.values()),
    },
    providers: {
      get: async (providerID: string) => providerRows.get(providerID),
      put: async (row: {
        id: string;
        name: string;
        source: "models.dev";
        env: string[];
        connected: boolean;
        options: Record<string, unknown>;
        modelCount: number;
        updatedAt: number;
      }) => {
        providerRows.set(row.id, row);
      },
    },
    vaultKeys: {
      get: async (id: string) => vaultKeyRows.get(id),
      put: async (row: {
        id: "auth-master-key";
        key: CryptoKey;
        algorithm: "AES-GCM";
        version: number;
        createdAt: number;
        updatedAt: number;
      }) => {
        vaultKeyRows.set(row.id, row);
      },
    },
  },
}));

mock.module("@/lib/runtime/db/runtime-db-tx", () => ({
  afterCommit: (effect: () => unknown | Promise<unknown>) => {
    afterCommitEffects.push(effect);
  },
  runTx: async (_tables: unknown[], fn: () => Promise<unknown>) => {
    const result = await fn();
    const effects = afterCommitEffects;
    afterCommitEffects = [];

    for (const effect of effects) {
      await effect();
    }

    return result;
  },
}));

mock.module("@/lib/runtime/events/runtime-events", () => ({
  publishRuntimeEvent: async (event: { type: string; payload: unknown }) => {
    publishedEvents.push(event);
  },
}));

mock.module("@/lib/runtime/util", () => ({
  now: () => {
    nowValue += 1;
    return nowValue;
  },
  randomId: (prefix: string) => `${prefix}_test`,
  mergeRecord: <T extends Record<string, unknown>>(
    base: T,
    patch?: Record<string, unknown>,
  ) => ({ ...base, ...(patch ?? {}) }) as T,
  isObject: (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value),
  parseProviderModel: (model: string) => {
    const [providerID, ...rest] = model.split("/");
    return {
      providerID,
      modelID: rest.join("/"),
    };
  },
  getModelCapabilities: (_modelID: string) => ["text"],
}));

const { makeAuthVaultStore } = await import("./auth-vault-store");
const { makeSecretVault } = await import("./secret-vault");
const { makeVaultKeyProvider } = await import("./vault-key-provider");

function createProviderRow(providerID: string) {
  return {
    id: providerID,
    name: providerID.toUpperCase(),
    source: "models.dev" as const,
    env: [`${providerID.toUpperCase()}_API_KEY`],
    connected: false,
    options: {},
    modelCount: 1,
    updatedAt: 0,
  };
}

function createStore() {
  return makeAuthVaultStore(makeSecretVault(makeVaultKeyProvider()));
}

beforeEach(() => {
  authRows.clear();
  providerRows.clear();
  vaultKeyRows.clear();
  publishedEvents.length = 0;
  afterCommitEffects = [];
  nowValue = 100;
});

afterAll(() => {
  mock.restore();
});

describe("AuthVaultStore", () => {
  it("writes sealed auth rows and returns decrypted auth", async () => {
    providerRows.set("openai", createProviderRow("openai"));
    const store = createStore();

    const stored = await Effect.runPromise(
      store.setAuth("openai", {
        type: "api",
        key: "sk-test",
        methodID: "apikey",
        methodType: "apikey",
        metadata: { scope: "dev" },
      }),
    );

    expect(stored).toEqual({
      type: "api",
      key: "sk-test",
      methodID: "apikey",
      methodType: "apikey",
      metadata: { scope: "dev" },
      createdAt: 101,
      updatedAt: 102,
    });

    const row = authRows.get("openai");
    expect(row).toBeDefined();
    expect(row?.recordType).toBe("api");
    expect(row?.version).toBe(1);
    expect(row?.ciphertext).toBeInstanceOf(ArrayBuffer);
    expect(row ? "record" in row : false).toBe(false);
    expect(row ? "key" in row : false).toBe(false);

    const loaded = await Effect.runPromise(store.getAuth("openai"));
    expect(loaded).toEqual(stored);
    expect(providerRows.get("openai")?.connected).toBe(true);
    expect(publishedEvents.map((event) => event.type)).toEqual([
      "runtime.auth.changed",
      "runtime.providers.changed",
    ]);
  });

  it("removes auth and marks the provider disconnected", async () => {
    providerRows.set("gitlab", createProviderRow("gitlab"));
    const store = createStore();

    await Effect.runPromise(
      store.setAuth("gitlab", {
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        methodID: "oauth",
        methodType: "oauth",
      }),
    );
    publishedEvents.length = 0;

    await Effect.runPromise(store.removeAuth("gitlab"));

    expect(authRows.has("gitlab")).toBe(false);
    expect(providerRows.get("gitlab")?.connected).toBe(false);
    expect(publishedEvents.map((event) => event.type)).toEqual([
      "runtime.auth.changed",
      "runtime.providers.changed",
    ]);
  });

  it("treats corrupt auth rows as missing and only warns once", async () => {
    providerRows.set("broken", createProviderRow("broken"));
    const store = createStore();

    await Effect.runPromise(
      store.setAuth("broken", {
        type: "api",
        key: "sk-corrupt",
        methodID: "apikey",
        methodType: "apikey",
      }),
    );

    const corruptRow = authRows.get("broken");
    if (!corruptRow) {
      throw new Error("Expected broken auth row to exist");
    }

    authRows.set("broken", {
      ...corruptRow,
      recordType: "oauth",
    });

    const originalWarn = console.warn;
    const warnMock = mock(() => undefined);
    console.warn = warnMock;

    try {
      const first = await Effect.runPromise(store.getAuth("broken"));
      const second = await Effect.runPromise(store.getAuth("broken"));

      expect(first).toBeUndefined();
      expect(second).toBeUndefined();
      expect(warnMock).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});
