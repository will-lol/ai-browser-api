import type { AuthRecord, AuthResult } from "@/background/runtime/auth-types";
import { runtimeDb } from "@/background/storage/runtime-db";
import { afterCommit, runTx } from "@/background/storage/runtime-db-tx";
import { publishRuntimeEvent } from "@/background/events/runtime-events";
import type { SecretVaultApi } from "@/background/security/secret-vault";
import { now } from "@/background/runtime/util";
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

function emitAuthChanged(providerID: string) {
  return Promise.all([
    publishRuntimeEvent({
      type: "runtime.auth.changed",
      payload: { providerID },
    }),
    publishRuntimeEvent({
      type: "runtime.providers.changed",
      payload: { providerIDs: [providerID] },
    }),
  ]).then(() => undefined);
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

  return {
    getAuth: (providerID: string) =>
      Effect.gen(function* () {
        const row = yield* readAuthRow(providerID);
        if (!row) return undefined;

        return yield* vault.openAuth(row).pipe(
          Effect.catchTag("VaultDecryptError", (error) =>
            Effect.sync(() => {
              warnCorruptAuth(providerID, error);
              return undefined;
            }),
          ),
        );
      }),
    listAuth: Effect.gen(function* () {
      const rows = yield* Effect.tryPromise({
        try: () => runtimeDb.auth.toArray(),
        catch: () =>
          new VaultKeyUnavailableError({
            operation: "listAuth",
            message: "Failed to list auth rows.",
          }),
      });

      const records = yield* Effect.forEach(
        rows,
        (row) =>
          vault.openAuth(row).pipe(
            Effect.map((record) => ({
              providerID: row.providerID,
              record,
            })),
            Effect.catchTag("VaultDecryptError", (error) =>
              Effect.sync(() => {
                warnCorruptAuth(row.providerID, error);
                return undefined;
              }),
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
        const existing = yield* readAuthRow(providerID).pipe(
          Effect.flatMap((row) => {
            if (!row) return Effect.succeed(undefined);
            return vault.openAuth(row).pipe(
              Effect.catchTag("VaultDecryptError", (error) =>
                Effect.sync(() => {
                  warnCorruptAuth(providerID, error);
                  return undefined;
                }),
              ),
            );
          }),
        );
        const auth = buildAuthRecord(existing, value);
        const sealed = yield* vault.sealAuth({
          providerID,
          record: auth,
        });

        yield* Effect.tryPromise({
          try: async () => {
            await runTx([runtimeDb.auth, runtimeDb.providers], async () => {
              await runtimeDb.auth.put(sealed);

              const provider = await runtimeDb.providers.get(providerID);
              if (provider) {
                await runtimeDb.providers.put({
                  ...provider,
                  connected: true,
                  updatedAt: auth.updatedAt,
                });
              }

              afterCommit(async () => {
                await emitAuthChanged(providerID);
              });
            });
          },
          catch: () =>
            new VaultKeyUnavailableError({
              operation: "setAuth",
              message: `Failed to persist auth for provider ${providerID}.`,
            }),
        });

        return auth;
      }),
    removeAuth: (providerID: string) =>
      Effect.tryPromise({
        try: async () => {
          await runTx([runtimeDb.auth, runtimeDb.providers], async () => {
            await runtimeDb.auth.delete(providerID);

            const provider = await runtimeDb.providers.get(providerID);
            if (provider) {
              await runtimeDb.providers.put({
                ...provider,
                connected: false,
                updatedAt: now(),
              });
            }

            afterCommit(async () => {
              await emitAuthChanged(providerID);
            });
          });
        },
        catch: () =>
          new VaultKeyUnavailableError({
            operation: "removeAuth",
            message: `Failed to remove auth for provider ${providerID}.`,
          }),
      }),
  };
}

type AuthVaultStoreApi = ReturnType<typeof makeAuthVaultStore>;

export class AuthVaultStore extends Context.Tag(
  "@llm-bridge/extension/AuthVaultStore",
)<AuthVaultStore, AuthVaultStoreApi>() {}
