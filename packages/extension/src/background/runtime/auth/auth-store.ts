import { RuntimeInternalError } from "@llm-bridge/contracts";
import * as Effect from "effect/Effect";
import type { AuthResult } from "@/background/runtime/auth/auth-types";
import { AuthVaultStore } from "@/background/security/auth-vault-store";
import { runSecurityEffect } from "@/background/security/runtime-security";

export type {
  AuthMethodType,
  AuthRecord,
  AuthResult,
} from "@/background/runtime/auth/auth-types";

function authStoreInternalError(message: string) {
  return new RuntimeInternalError({
    operation: "auth-store",
    message,
  });
}

export function getAuth(providerID: string) {
  return Effect.flatMap(AuthVaultStore, (store) => store.getAuth(providerID)).pipe(
    Effect.mapError(() =>
      authStoreInternalError(`Failed to load auth for provider ${providerID}.`),
    ),
  );
}

export function listAuth() {
  return Effect.flatMap(AuthVaultStore, (store) => store.listAuth).pipe(
    Effect.mapError(() =>
      authStoreInternalError("Failed to list stored provider auth."),
    ),
  );
}

export function setAuth(providerID: string, value: AuthResult) {
  return Effect.flatMap(AuthVaultStore, (store) => store.setAuth(providerID, value)).pipe(
    Effect.mapError(() =>
      authStoreInternalError(
        `Failed to persist auth for provider ${providerID}.`,
      ),
    ),
  );
}

export function removeAuth(providerID: string) {
  return Effect.flatMap(AuthVaultStore, (store) => store.removeAuth(providerID)).pipe(
    Effect.mapError(() =>
      authStoreInternalError(`Failed to remove auth for provider ${providerID}.`),
    ),
  );
}

export { runSecurityEffect };
