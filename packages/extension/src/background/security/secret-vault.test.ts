import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type { AuthRecord } from "@/background/runtime/auth/auth-types";
import { makeSecretVault } from "./secret-vault";

async function createSecretVault() {
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

  return makeSecretVault({
    getOrCreateAuthKey: Effect.succeed(key),
  });
}

describe("SecretVault", () => {
  it("round-trips API key auth records", async () => {
    const vault = await createSecretVault();
    const record: AuthRecord = {
      type: "api",
      key: "sk-test",
      methodID: "apikey",
      methodType: "apikey",
      metadata: { scope: "dev" },
      createdAt: 1,
      updatedAt: 2,
    };

    const sealed = await Effect.runPromise(
      vault.sealAuth({
        providerID: "openai",
        record,
      }),
    );

    expect(sealed.recordType).toBe("api");
    expect(sealed.version).toBe(1);
    expect(sealed.ciphertext).toBeInstanceOf(ArrayBuffer);
    expect("record" in sealed).toBe(false);
    expect("key" in sealed).toBe(false);

    const opened = await Effect.runPromise(vault.openAuth(sealed));
    expect(opened).toEqual(record);
  });

  it("round-trips OAuth auth records", async () => {
    const vault = await createSecretVault();
    const record: AuthRecord = {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expiresAt: 500,
      accountId: "acct_123",
      methodID: "oauth",
      methodType: "oauth",
      metadata: { authMode: "oauth" },
      createdAt: 10,
      updatedAt: 11,
    };

    const sealed = await Effect.runPromise(
      vault.sealAuth({
        providerID: "gitlab",
        record,
      }),
    );

    const opened = await Effect.runPromise(vault.openAuth(sealed));
    expect(opened).toEqual(record);
  });

  it("fails decryption when auth metadata used as AAD changes", async () => {
    const vault = await createSecretVault();
    const sealed = await Effect.runPromise(
      vault.sealAuth({
        providerID: "openai",
        record: {
          type: "api",
          key: "sk-live",
          methodID: "apikey",
          methodType: "apikey",
          createdAt: 1,
          updatedAt: 2,
        },
      }),
    );

    await expect(
      Effect.runPromise(
        vault.openAuth({
          ...sealed,
          recordType: "oauth",
        }),
      ),
    ).rejects.toBeDefined();
  });
});
