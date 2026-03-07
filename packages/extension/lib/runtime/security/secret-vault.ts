import type { AuthRecord } from "@/lib/runtime/auth-types";
import type { RuntimeDbAuth } from "@/lib/runtime/db/runtime-db-types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  VaultKeyProvider,
  type VaultKeyProviderApi,
} from "./vault-key-provider";
import {
  VaultDecryptError,
  VaultEncryptError,
  VaultKeyUnavailableError,
} from "./vault-errors";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AUTH_VAULT_VERSION = 1 as const;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObjectRecord(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

function isAuthRecord(value: unknown): value is AuthRecord {
  if (!isObjectRecord(value)) return false;
  if (
    typeof value.createdAt !== "number" ||
    typeof value.updatedAt !== "number"
  ) {
    return false;
  }
  if (value.metadata != null && !isStringRecord(value.metadata)) {
    return false;
  }

  if (value.type === "api") {
    return typeof value.key === "string";
  }

  if (value.type === "oauth") {
    if (typeof value.access !== "string") return false;
    if (value.refresh != null && typeof value.refresh !== "string")
      return false;
    if (value.expiresAt != null && typeof value.expiresAt !== "number")
      return false;
    if (value.accountId != null && typeof value.accountId !== "string")
      return false;
    return true;
  }

  return false;
}

function authAdditionalData(
  providerID: string,
  recordType: RuntimeDbAuth["recordType"],
  version: number,
) {
  return Uint8Array.from(
    encoder.encode(`llm-bridge-auth:v${version}:${providerID}:${recordType}`),
  );
}

export function makeSecretVault(
  keyProvider: VaultKeyProviderApi,
) {
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

        if (!isAuthRecord(parsed)) {
          return yield* new VaultDecryptError({
            providerID: row.providerID,
            message: `Auth payload for provider ${row.providerID} is invalid.`,
          });
        }

        return parsed;
      }),
  };
}

export type SecretVaultApi = ReturnType<typeof makeSecretVault>;

export class SecretVault extends Context.Tag(
  "@llm-bridge/extension/SecretVault",
)<SecretVault, SecretVaultApi>() {}

export const SecretVaultLive = Layer.effect(
  SecretVault,
  Effect.map(VaultKeyProvider, makeSecretVault),
);
