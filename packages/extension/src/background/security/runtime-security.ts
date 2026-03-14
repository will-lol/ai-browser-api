import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Layer from "effect/Layer";
import { AuthVaultStore, makeAuthVaultStore } from "./auth-vault-store";
import { makeSecretVault, SecretVault } from "./secret-vault";
import { makeVaultKeyProvider, VaultKeyProvider } from "./vault-key-provider";

type RuntimeSecurityServices =
  | VaultKeyProvider
  | SecretVault
  | AuthVaultStore;

const RuntimeSecurityLive = Layer.effectContext(
  Effect.gen(function* () {
    const keyProvider = yield* makeVaultKeyProvider();
    const secretVault = makeSecretVault(keyProvider);
    const authVaultStore = makeAuthVaultStore(secretVault);

    return pipe(
      Context.make(VaultKeyProvider, keyProvider),
      Context.add(SecretVault, secretVault),
      Context.add(AuthVaultStore, authVaultStore),
    );
  }),
);

export function provideRuntimeSecurity<A, E, R>(
  effect: Effect.Effect<A, E, R | RuntimeSecurityServices>,
) {
  return Effect.provide(effect, RuntimeSecurityLive);
}
