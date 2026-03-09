import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { AuthVaultStore, makeAuthVaultStore } from "./auth-vault-store";
import { makeSecretVault, SecretVault } from "./secret-vault";
import { makeVaultKeyProvider, VaultKeyProvider } from "./vault-key-provider";

const RuntimeSecurityLayer = Layer.effectContext(
  Effect.sync(() => {
    const keyProvider = makeVaultKeyProvider();
    const secretVault = makeSecretVault(keyProvider);
    const authVaultStore = makeAuthVaultStore(secretVault);

    return pipe(
      Context.make(VaultKeyProvider, keyProvider),
      Context.add(SecretVault, secretVault),
      Context.add(AuthVaultStore, authVaultStore),
    );
  }),
);

type RuntimeSecurityContext = Context.Context<
  VaultKeyProvider | SecretVault | AuthVaultStore
>;

type RuntimeSecurityRuntime = {
  readonly scope: Scope.CloseableScope;
  readonly context: RuntimeSecurityContext;
};

let runtimeSecurityPromise: Promise<RuntimeSecurityRuntime> | null = null;

async function getRuntimeSecurityRuntime() {
  if (runtimeSecurityPromise) {
    return runtimeSecurityPromise;
  }

  runtimeSecurityPromise = Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(RuntimeSecurityLayer, scope);

      return {
        scope,
        context,
      } satisfies RuntimeSecurityRuntime;
    }),
  ).catch((error) => {
    runtimeSecurityPromise = null;
    throw error;
  });

  return runtimeSecurityPromise;
}

export async function initializeRuntimeSecurityLayer() {
  await getRuntimeSecurityRuntime();
}

export async function runSecurityEffect<A, E>(
  effect: Effect.Effect<A, E, VaultKeyProvider | SecretVault | AuthVaultStore>,
): Promise<A> {
  const runtime = await getRuntimeSecurityRuntime();
  return Effect.runPromise(effect.pipe(Effect.provide(runtime.context)));
}
