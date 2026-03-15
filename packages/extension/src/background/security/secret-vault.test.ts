import { describe, expect, it } from "vitest";
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

  return {
    key,
    vault: makeSecretVault({
      getOrCreateAuthKey: Effect.succeed(key),
    }),
  };
}

describe("SecretVault", () => {
  it("round-trips API key auth records", async () => {
    const { vault } = await createSecretVault();
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
    const { vault } = await createSecretVault();
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
    const { vault } = await createSecretVault();
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

  it("fails when the decrypted payload does not match the auth schema", async () => {
    const { key, vault } = await createSecretVault();
    const iv = Uint8Array.from(crypto.getRandomValues(new Uint8Array(12)));
    const payload = Uint8Array.from(
      new TextEncoder().encode(JSON.stringify({ nope: true })),
    );
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: Uint8Array.from(
          new TextEncoder().encode("llm-bridge-auth:v1:openai:api"),
        ),
      },
      key,
      payload,
    );

    const result = await Effect.runPromise(
      Effect.either(
        vault.openAuth({
          providerID: "openai",
          recordType: "api",
          version: 1,
          iv,
          ciphertext,
          createdAt: 1,
          updatedAt: 2,
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("VaultDecryptError");
    }
  });
});
