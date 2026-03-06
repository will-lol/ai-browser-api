import { runtimeDb } from "@/lib/runtime/db/runtime-db";
import type { RuntimeDbVaultKey } from "@/lib/runtime/db/runtime-db-types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { VaultKeyUnavailableError } from "./vault-errors";

export const AUTH_MASTER_KEY_ID = "auth-master-key" as const;
const AUTH_MASTER_KEY_VERSION = 1 as const;
const AUTH_MASTER_KEY_ALGORITHM = "AES-GCM" as const;

export interface VaultKeyProviderApi {
  readonly getOrCreateAuthKey: Effect.Effect<
    CryptoKey,
    VaultKeyUnavailableError
  >;
}

export class VaultKeyProvider extends Context.Tag(
  "@llm-bridge/extension/VaultKeyProvider",
)<VaultKeyProvider, VaultKeyProviderApi>() {}

function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
}

function createVaultKeyRow(key: CryptoKey): RuntimeDbVaultKey {
  const timestamp = Date.now();

  return {
    id: AUTH_MASTER_KEY_ID,
    key,
    algorithm: AUTH_MASTER_KEY_ALGORITHM,
    version: AUTH_MASTER_KEY_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function makeVaultKeyProvider(): VaultKeyProviderApi {
  let cachedAuthKey: CryptoKey | undefined;

  const readStoredKey = Effect.tryPromise({
    try: () => runtimeDb.vaultKeys.get(AUTH_MASTER_KEY_ID),
    catch: () =>
      new VaultKeyUnavailableError({
        operation: "readAuthKey",
        message: "Failed to read the auth vault key from IndexedDB.",
      }),
  }).pipe(
    Effect.flatMap((row) => {
      if (!row) {
        return Effect.tryPromise({
          try: async () => {
            const key = await crypto.subtle.generateKey(
              {
                name: AUTH_MASTER_KEY_ALGORITHM,
                length: 256,
              },
              false,
              ["encrypt", "decrypt"],
            );

            if (!isCryptoKey(key)) {
              throw new Error("Generated auth key is invalid");
            }

            await runtimeDb.vaultKeys.put(createVaultKeyRow(key));
            return key;
          },
          catch: () =>
            new VaultKeyUnavailableError({
              operation: "createAuthKey",
              message: "Failed to create the auth vault key.",
            }),
        });
      }

      if (!isCryptoKey(row.key)) {
        return Effect.fail(
          new VaultKeyUnavailableError({
            operation: "readAuthKey",
            message: "Stored auth vault key is invalid.",
          }),
        );
      }

      return Effect.succeed(row.key);
    }),
    Effect.tap((key) =>
      Effect.sync(() => {
        cachedAuthKey = key;
      }),
    ),
  );

  return {
    getOrCreateAuthKey: Effect.suspend(() => {
      if (cachedAuthKey) {
        return Effect.succeed(cachedAuthKey);
      }

      return readStoredKey;
    }),
  };
}

export const VaultKeyProviderLive = Layer.sync(
  VaultKeyProvider,
  makeVaultKeyProvider,
);
