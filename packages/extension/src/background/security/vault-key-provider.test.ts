import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mock } from "@/test-utils/vitest-compat";
import * as Effect from "effect/Effect";

const vaultKeyRows = new Map<
  string,
  {
    id: "auth-master-key";
    key: unknown;
    algorithm: "AES-GCM";
    version: number;
    createdAt: number;
    updatedAt: number;
  }
>();

const getMock = mock(async (id: string) => vaultKeyRows.get(id));
const putMock = mock(
  async (row: {
    id: "auth-master-key";
    key: unknown;
    algorithm: "AES-GCM";
    version: number;
    createdAt: number;
    updatedAt: number;
  }) => {
    vaultKeyRows.set(row.id, row);
  },
);

mock.module("@/background/storage/runtime-db", () => ({
  runtimeDb: {
    vaultKeys: {
      get: getMock,
      put: putMock,
    },
  },
}));

const { AUTH_MASTER_KEY_ID, makeVaultKeyProvider } =
  await import("./vault-key-provider");

async function createCryptoKey() {
  const key = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );

  if (!(key instanceof CryptoKey)) {
    throw new Error("Expected AES vault key to be a CryptoKey");
  }

  return key;
}

beforeEach(() => {
  vaultKeyRows.clear();
  getMock.mockClear();
  putMock.mockClear();
});

afterAll(() => {
  mock.restore();
});

describe("makeVaultKeyProvider", () => {
  it("creates one non-extractable auth key and reuses the stored key", async () => {
    const firstProvider = await Effect.runPromise(makeVaultKeyProvider());
    const firstKey = await Effect.runPromise(firstProvider.getOrCreateAuthKey);
    const cachedKey = await Effect.runPromise(firstProvider.getOrCreateAuthKey);

    expect(firstKey).toBe(cachedKey);
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(vaultKeyRows.get(AUTH_MASTER_KEY_ID)?.algorithm).toBe("AES-GCM");

    const secondProvider = await Effect.runPromise(makeVaultKeyProvider());
    const secondKey = await Effect.runPromise(
      secondProvider.getOrCreateAuthKey,
    );

    expect(secondKey).toBe(firstKey);
    expect(putMock).toHaveBeenCalledTimes(1);
    await expect(
      crypto.subtle.exportKey("raw", firstKey),
    ).rejects.toBeDefined();
  });

  it("single-flights concurrent callers on a cold cache", async () => {
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });

    getMock.mockImplementationOnce(async () => {
      await readGate;
      return vaultKeyRows.get(AUTH_MASTER_KEY_ID);
    });

    const provider = await Effect.runPromise(makeVaultKeyProvider());
    const pendingKeys = Effect.runPromise(
      Effect.all(
        [provider.getOrCreateAuthKey, provider.getOrCreateAuthKey],
        { concurrency: "unbounded" },
      ),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(getMock).toHaveBeenCalledTimes(1);

    releaseRead();
    const [firstKey, secondKey] = await pendingKeys;

    expect(firstKey).toBe(secondKey);
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it("retries after an invalid stored key without caching the failure", async () => {
    vaultKeyRows.set(AUTH_MASTER_KEY_ID, {
      id: AUTH_MASTER_KEY_ID,
      key: { invalid: true },
      algorithm: "AES-GCM",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    });

    const provider = await Effect.runPromise(makeVaultKeyProvider());
    const firstAttempt = await Effect.runPromise(
      Effect.either(provider.getOrCreateAuthKey),
    );

    expect(firstAttempt._tag).toBe("Left");
    if (firstAttempt._tag === "Left") {
      expect(firstAttempt.left._tag).toBe("VaultKeyUnavailableError");
      expect(firstAttempt.left.operation).toBe("readAuthKey");
    }

    const repairedKey = await createCryptoKey();
    vaultKeyRows.set(AUTH_MASTER_KEY_ID, {
      id: AUTH_MASTER_KEY_ID,
      key: repairedKey,
      algorithm: "AES-GCM",
      version: 1,
      createdAt: 2,
      updatedAt: 2,
    });

    const secondAttempt = await Effect.runPromise(provider.getOrCreateAuthKey);

    expect(secondAttempt).toBe(repairedKey);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(putMock).toHaveBeenCalledTimes(0);
  });

  it("retries after a read failure and eventually creates a key", async () => {
    getMock.mockImplementationOnce(async () => {
      throw new Error("temporary read failure");
    });

    const provider = await Effect.runPromise(makeVaultKeyProvider());
    const firstAttempt = await Effect.runPromise(
      Effect.either(provider.getOrCreateAuthKey),
    );

    expect(firstAttempt._tag).toBe("Left");
    if (firstAttempt._tag === "Left") {
      expect(firstAttempt.left._tag).toBe("VaultKeyUnavailableError");
      expect(firstAttempt.left.operation).toBe("readAuthKey");
    }

    const recoveredKey = await Effect.runPromise(provider.getOrCreateAuthKey);

    expect(recoveredKey).toBeInstanceOf(CryptoKey);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(putMock).toHaveBeenCalledTimes(1);
  });
});
