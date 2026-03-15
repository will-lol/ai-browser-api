import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mock } from "@/test-utils/vitest-compat";
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

let nowValue = 100;

mock.module("@/background/storage/runtime-db", () => ({
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

mock.module("@/background/storage/runtime-db-tx", () => ({
  runTx: (_tables: unknown[], fn: () => Effect.Effect<unknown>) => fn(),
}));

mock.module("@/background/runtime/core/util", () => ({
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

async function createStore() {
  const keyProvider = await Effect.runPromise(makeVaultKeyProvider());
  return makeAuthVaultStore(makeSecretVault(keyProvider));
}

beforeEach(() => {
  authRows.clear();
  providerRows.clear();
  vaultKeyRows.clear();
  nowValue = 100;
});

afterAll(() => {
  mock.restore();
});

describe("AuthVaultStore", () => {
  it("writes sealed auth rows and returns decrypted auth", async () => {
    providerRows.set("openai", createProviderRow("openai"));
    const store = await createStore();

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
  });

  it("removes auth and marks the provider disconnected", async () => {
    providerRows.set("gitlab", createProviderRow("gitlab"));
    const store = await createStore();

    await Effect.runPromise(
      store.setAuth("gitlab", {
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        methodID: "oauth",
        methodType: "oauth",
      }),
    );

    await Effect.runPromise(store.removeAuth("gitlab"));

    expect(authRows.has("gitlab")).toBe(false);
    expect(providerRows.get("gitlab")?.connected).toBe(false);
  });

  it("treats corrupt auth rows as missing and only warns once", async () => {
    providerRows.set("broken_get", createProviderRow("broken_get"));
    const store = await createStore();

    await Effect.runPromise(
      store.setAuth("broken_get", {
        type: "api",
        key: "sk-corrupt",
        methodID: "apikey",
        methodType: "apikey",
      }),
    );

    const corruptRow = authRows.get("broken_get");
    if (!corruptRow) {
      throw new Error("Expected broken auth row to exist");
    }

    authRows.set("broken_get", {
      ...corruptRow,
      recordType: "oauth",
    });

    const originalWarn = console.warn;
    const warnMock = mock(() => undefined);
    console.warn = warnMock;

    try {
      const first = await Effect.runPromise(store.getAuth("broken_get"));
      const second = await Effect.runPromise(store.getAuth("broken_get"));

      expect(first).toBeUndefined();
      expect(second).toBeUndefined();
      expect(warnMock).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("skips corrupt rows during listAuth and only warns once", async () => {
    const store = await createStore();

    await Effect.runPromise(
      store.setAuth("openai_list", {
        type: "api",
        key: "sk-valid",
        methodID: "apikey",
        methodType: "apikey",
      }),
    );
    await Effect.runPromise(
      store.setAuth("broken_list", {
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        methodID: "oauth",
        methodType: "oauth",
      }),
    );

    const corruptRow = authRows.get("broken_list");
    if (!corruptRow) {
      throw new Error("Expected broken_list auth row to exist");
    }

    authRows.set("broken_list", {
      ...corruptRow,
      recordType: "api",
    });

    const originalWarn = console.warn;
    const warnMock = mock(() => undefined);
    console.warn = warnMock;

    try {
      const first = await Effect.runPromise(store.listAuth);
      const second = await Effect.runPromise(store.listAuth);

      expect(first).toHaveProperty("openai_list");
      expect(first).not.toHaveProperty("broken_list");
      expect(second).toHaveProperty("openai_list");
      expect(second).not.toHaveProperty("broken_list");
      expect(warnMock).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("treats corrupt existing auth as missing when writing a fresh record", async () => {
    providerRows.set("recover", createProviderRow("recover"));
    const store = await createStore();

    await Effect.runPromise(
      store.setAuth("recover", {
        type: "api",
        key: "sk-old",
        methodID: "apikey",
        methodType: "apikey",
      }),
    );

    const corruptRow = authRows.get("recover");
    if (!corruptRow) {
      throw new Error("Expected recover auth row to exist");
    }

    authRows.set("recover", {
      ...corruptRow,
      recordType: "oauth",
    });

    const originalWarn = console.warn;
    const warnMock = mock(() => undefined);
    console.warn = warnMock;

    try {
      const stored = await Effect.runPromise(
        store.setAuth("recover", {
          type: "api",
          key: "sk-new",
          methodID: "apikey",
          methodType: "apikey",
        }),
      );

      expect(stored).toEqual({
        type: "api",
        key: "sk-new",
        methodID: "apikey",
        methodType: "apikey",
        createdAt: 103,
        updatedAt: 104,
      });
      expect(warnMock).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});
