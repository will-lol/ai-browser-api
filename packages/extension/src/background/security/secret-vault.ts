import { authRecordSchema, type AuthRecord } from "@/background/runtime/auth/auth-types";
import type { RuntimeDbAuth } from "@/background/storage/runtime-db-types";
import { decodeSchemaOrUndefined } from "@/background/runtime/core/effect-schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { VaultKeyProviderApi } from "./vault-key-provider";
import { VaultDecryptError, VaultEncryptError } from "./vault-errors";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AUTH_VAULT_VERSION = 1 as const;

function authAdditionalData(
  providerID: string,
  recordType: RuntimeDbAuth["recordType"],
  version: number,
) {
  return Uint8Array.from(
    encoder.encode(`llm-bridge-auth:v${version}:${providerID}:${recordType}`),
  );
}

export function makeSecretVault(keyProvider: VaultKeyProviderApi) {
  return {
    sealAuth: ({
      providerID,
      record,
    }: {
      providerID: string;
      record: AuthRecord;
    }) =>
      Effect.gen(function* () {
        const key = yield* keyProvider.getOrCreateAuthKey;
        const iv = yield* Effect.sync(() =>
          Uint8Array.from(crypto.getRandomValues(new Uint8Array(12))),
        );
        const payload = yield* Effect.try({
          try: () => Uint8Array.from(encoder.encode(JSON.stringify(record))),
          catch: () =>
            new VaultEncryptError({
              providerID,
              message: `Failed to serialize auth for provider ${providerID}.`,
            }),
        });
        const ciphertext = yield* Effect.tryPromise({
          try: () =>
            crypto.subtle.encrypt(
              {
                name: "AES-GCM",
                iv,
                additionalData: authAdditionalData(
                  providerID,
                  record.type,
                  AUTH_VAULT_VERSION,
                ),
              },
              key,
              payload,
            ),
          catch: () =>
            new VaultEncryptError({
              providerID,
              message: `Failed to encrypt auth for provider ${providerID}.`,
            }),
        });

        return {
          providerID,
          recordType: record.type,
          version: AUTH_VAULT_VERSION,
          iv,
          ciphertext,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      }),
    openAuth: (row: RuntimeDbAuth) =>
      Effect.gen(function* () {
        if (row.version !== AUTH_VAULT_VERSION) {
          return yield* new VaultDecryptError({
            providerID: row.providerID,
            message: `Auth vault version ${row.version} is unsupported.`,
          });
        }

        const key = yield* keyProvider.getOrCreateAuthKey;
        const plaintext = yield* Effect.tryPromise({
          try: () =>
            crypto.subtle.decrypt(
              {
                name: "AES-GCM",
                iv: Uint8Array.from(row.iv),
                additionalData: authAdditionalData(
                  row.providerID,
                  row.recordType,
                  row.version,
                ),
              },
              key,
              row.ciphertext,
            ),
          catch: () =>
            new VaultDecryptError({
              providerID: row.providerID,
              message: `Failed to decrypt auth for provider ${row.providerID}.`,
            }),
        });
        const parsed = yield* Effect.try({
          try: () => JSON.parse(decoder.decode(new Uint8Array(plaintext))),
          catch: () =>
            new VaultDecryptError({
              providerID: row.providerID,
              message: `Failed to parse auth payload for provider ${row.providerID}.`,
            }),
        });

        const authRecord = decodeSchemaOrUndefined(authRecordSchema, parsed);
        if (!authRecord) {
          return yield* new VaultDecryptError({
            providerID: row.providerID,
            message: `Auth payload for provider ${row.providerID} is invalid.`,
          });
        }

        return authRecord;
      }),
  };
}

export type SecretVaultApi = ReturnType<typeof makeSecretVault>;

export class SecretVault extends Context.Tag(
  "@llm-bridge/extension/SecretVault",
)<SecretVault, SecretVaultApi>() {}
