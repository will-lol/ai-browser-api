import { runtimeDb } from "@/background/storage/runtime-db";
import type { RuntimeDbVaultKey } from "@/background/storage/runtime-db-types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SynchronizedRef from "effect/SynchronizedRef";
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

function readStoredKeyRow() {
  return Effect.tryPromise({
    try: () => runtimeDb.vaultKeys.get(AUTH_MASTER_KEY_ID),
    catch: () =>
      new VaultKeyUnavailableError({
        operation: "readAuthKey",
        message: "Failed to read the auth vault key from IndexedDB.",
      }),
  });
}

function validateStoredKey(row: RuntimeDbVaultKey) {
  if (!isCryptoKey(row.key)) {
    return new VaultKeyUnavailableError({
      operation: "readAuthKey",
      message: "Stored auth vault key is invalid.",
    });
  }

  return row.key;
}

function createAndStoreAuthKey() {
  return Effect.gen(function* () {
    const generatedKey = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.generateKey(
          {
            name: AUTH_MASTER_KEY_ALGORITHM,
            length: 256,
          },
          false,
          ["encrypt", "decrypt"],
        ),
      catch: () =>
        new VaultKeyUnavailableError({
          operation: "createAuthKey",
          message: "Failed to create the auth vault key.",
        }),
    });

    if (!isCryptoKey(generatedKey)) {
      return yield* new VaultKeyUnavailableError({
        operation: "createAuthKey",
        message: "Generated auth vault key is invalid.",
      });
    }

    yield* Effect.tryPromise({
      try: () => runtimeDb.vaultKeys.put(createVaultKeyRow(generatedKey)),
      catch: () =>
        new VaultKeyUnavailableError({
          operation: "createAuthKey",
          message: "Failed to create the auth vault key.",
        }),
    });

    return generatedKey;
  });
}

function loadOrCreateAuthKey() {
  return Effect.flatMap(readStoredKeyRow(), (row) => {
    if (!row) {
      return createAndStoreAuthKey();
    }

    const validatedKey = validateStoredKey(row);
    if (validatedKey instanceof VaultKeyUnavailableError) {
      return Effect.fail(validatedKey);
    }

    return Effect.succeed(validatedKey);
  });
}

export function makeVaultKeyProvider(): Effect.Effect<VaultKeyProviderApi> {
  return Effect.gen(function* () {
    const keyCache = yield* SynchronizedRef.make(Option.none<CryptoKey>());

    return {
      getOrCreateAuthKey: SynchronizedRef.modifyEffect(keyCache, (cachedKey) => {
        if (Option.isSome(cachedKey)) {
          return Effect.succeed([cachedKey.value, cachedKey] as const);
        }

        return Effect.map(loadOrCreateAuthKey(), (loadedKey) => [
          loadedKey,
          Option.some(loadedKey),
        ] as const);
      }),
    } satisfies VaultKeyProviderApi;
  });
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
