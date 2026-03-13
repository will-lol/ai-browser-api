import type { AuthRecord, AuthResult } from "@/background/runtime/auth/auth-types";
import { runtimeDb } from "@/background/storage/runtime-db";
import { runTx } from "@/background/storage/runtime-db-tx";
import type { SecretVaultApi } from "@/background/security/secret-vault";
import { now } from "@/background/runtime/core/util";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { VaultDecryptError, VaultKeyUnavailableError } from "./vault-errors";

const warnedCorruptAuthProviders = new Set<string>();

function warnCorruptAuth(providerID: string, error: VaultDecryptError) {
  if (warnedCorruptAuthProviders.has(providerID)) return;
  warnedCorruptAuthProviders.add(providerID);
  console.warn("auth vault decrypt failed; treating row as missing", {
    providerID,
    error,
  });
}

function buildAuthRecord(
  existing: AuthRecord | undefined,
  value: AuthResult,
): AuthRecord {
  const createdAt = existing?.createdAt ?? now();
  const updatedAt = now();

  if (value.type === "api") {
    return {
      type: "api",
      key: value.key,
      methodID: value.methodID,
      methodType: value.methodType,
      metadata: value.metadata,
      createdAt,
      updatedAt,
    };
  }

  return {
    type: "oauth",
    access: value.access,
    refresh: value.refresh,
    expiresAt: value.expiresAt,
    accountId: value.accountId,
    methodID: value.methodID,
    methodType: value.methodType,
    metadata: value.metadata,
    createdAt,
    updatedAt,
  };
}

export function makeAuthVaultStore(vault: SecretVaultApi) {
  const readAuthRow = (providerID: string) =>
    Effect.tryPromise({
      try: () => runtimeDb.auth.get(providerID),
      catch: () =>
        new VaultKeyUnavailableError({
          operation: "getAuth",
          message: `Failed to read auth for provider ${providerID}.`,
        }),
    });

  const readAllAuthRows = Effect.tryPromise({
    try: () => runtimeDb.auth.toArray(),
    catch: () =>
      new VaultKeyUnavailableError({
        operation: "listAuth",
        message: "Failed to list auth rows.",
      }),
  });

  const openAuthRow = (row: {
    providerID: string;
    recordType: "api" | "oauth";
    version: number;
    iv: Uint8Array;
    ciphertext: ArrayBuffer;
    createdAt: number;
    updatedAt: number;
  }) =>
    vault.openAuth(row).pipe(
      Effect.catchTag("VaultDecryptError", (error) =>
        Effect.sync(() => {
          warnCorruptAuth(row.providerID, error);
          return undefined;
        }),
      ),
    );

  const readAuthRecord = (providerID: string) =>
    Effect.flatMap(readAuthRow(providerID), (row) => {
      if (!row) {
        return Effect.succeed(undefined);
      }

      return openAuthRow(row);
    });

  const updateProviderConnection = (
    providerID: string,
    connected: boolean,
    updatedAt: number,
  ) =>
    Effect.gen(function* () {
      const provider = yield* Effect.tryPromise({
        try: () => runtimeDb.providers.get(providerID),
        catch: (error) => error,
      });

      if (!provider) {
        return;
      }

      yield* Effect.tryPromise({
        try: () =>
          runtimeDb.providers.put({
            ...provider,
            connected,
            updatedAt,
          }),
        catch: (error) => error,
      });
    });

  return {
    getAuth: (providerID: string) => readAuthRecord(providerID),
    listAuth: Effect.gen(function* () {
      const rows = yield* readAllAuthRows;

      const records = yield* Effect.forEach(
        rows,
        (row) =>
          openAuthRow(row).pipe(
            Effect.map((record) =>
              record
                ? {
                    providerID: row.providerID,
                    record,
                  }
                : undefined,
            ),
          ),
        { concurrency: 1 },
      );

      const authMap: Record<string, AuthRecord> = {};
      for (const entry of records) {
        if (!entry) continue;
        authMap[entry.providerID] = entry.record;
      }
      return authMap;
    }),
    setAuth: (providerID: string, value: AuthResult) =>
      Effect.gen(function* () {
        const existing = yield* readAuthRecord(providerID);
        const auth = buildAuthRecord(existing, value);
        const sealed = yield* vault.sealAuth({
          providerID,
          record: auth,
        });

        yield* runTx([runtimeDb.auth, runtimeDb.providers], () =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: () => runtimeDb.auth.put(sealed),
              catch: (error) => error,
            });

            yield* updateProviderConnection(providerID, true, auth.updatedAt);
          }),
        ).pipe(
          Effect.mapError(() =>
            new VaultKeyUnavailableError({
              operation: "setAuth",
              message: `Failed to persist auth for provider ${providerID}.`,
            }),
          ),
        );

        return auth;
      }),
    removeAuth: (providerID: string) =>
      runTx([runtimeDb.auth, runtimeDb.providers], () =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => runtimeDb.auth.delete(providerID),
            catch: (error) => error,
          });

          yield* updateProviderConnection(providerID, false, now());
        }),
      ).pipe(
        Effect.mapError(() =>
          new VaultKeyUnavailableError({
            operation: "removeAuth",
            message: `Failed to remove auth for provider ${providerID}.`,
          }),
        ),
      ),
  };
}

type AuthVaultStoreApi = ReturnType<typeof makeAuthVaultStore>;

export class AuthVaultStore extends Context.Tag(
  "@llm-bridge/extension/AuthVaultStore",
)<AuthVaultStore, AuthVaultStoreApi>() {}
