import { RuntimeInternalError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import type { AuthResult } from "@/lib/runtime/auth-types";
import { AuthVaultStore } from "@/lib/runtime/security/auth-vault-store";
import { runSecurityEffect } from "@/lib/runtime/security/runtime-security";

export type { AuthRecord, AuthResult } from "@/lib/runtime/auth-types";

function authStoreInternalError(message: string) {
  return new RuntimeInternalError({
    operation: "auth-store",
    message,
  });
}

export async function getAuth(providerID: string) {
  return runSecurityEffect(
    Effect.flatMap(AuthVaultStore, (store) => store.getAuth(providerID)).pipe(
      Effect.mapError(() =>
        authStoreInternalError(
          `Failed to load auth for provider ${providerID}.`,
        ),
      ),
    ),
  );
}

export async function listAuth() {
  return runSecurityEffect(
    Effect.flatMap(AuthVaultStore, (store) => store.listAuth).pipe(
      Effect.mapError(() =>
        authStoreInternalError("Failed to list stored provider auth."),
      ),
    ),
  );
}

export async function setAuth(providerID: string, value: AuthResult) {
  return runSecurityEffect(
    Effect.flatMap(AuthVaultStore, (store) =>
      store.setAuth(providerID, value),
    ).pipe(
      Effect.mapError(() =>
        authStoreInternalError(
          `Failed to persist auth for provider ${providerID}.`,
        ),
      ),
    ),
  );
}

export async function removeAuth(providerID: string) {
  await runSecurityEffect(
    Effect.flatMap(AuthVaultStore, (store) =>
      store.removeAuth(providerID),
    ).pipe(
      Effect.mapError(() =>
        authStoreInternalError(
          `Failed to remove auth for provider ${providerID}.`,
        ),
      ),
    ),
  );
}
