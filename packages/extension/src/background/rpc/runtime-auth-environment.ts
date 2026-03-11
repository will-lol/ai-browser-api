import * as Effect from "effect/Effect";
import type { RuntimeEnvironmentApi } from "@llm-bridge/runtime-core";
import { getAuthFlowManager } from "@/background/runtime/auth/auth-flow-manager";
import { disconnectProvider } from "@/background/runtime/auth/provider-auth";

export function makeRuntimeAuthEnvironment(): RuntimeEnvironmentApi["auth"] {
  return {
    openProviderAuthWindow: (providerID: string) =>
      Effect.promise(() => {
        const manager = getAuthFlowManager();
        return manager.openProviderAuthWindow(providerID);
      }),
    getProviderAuthFlow: (providerID: string) =>
      Effect.promise(async () => {
        const manager = getAuthFlowManager();
        return {
          providerID,
          result: await manager.getProviderAuthFlow(providerID),
        };
      }),
    startProviderAuthFlow: (input: {
      providerID: string;
      methodID: string;
      values?: Record<string, string>;
    }) =>
      Effect.promise(async () => {
        const manager = getAuthFlowManager();
        return {
          providerID: input.providerID,
          result: await manager.startProviderAuthFlow(input),
        };
      }),
    cancelProviderAuthFlow: (input: {
      providerID: string;
      reason?: string;
    }) =>
      Effect.promise(async () => {
        const manager = getAuthFlowManager();
        return {
          providerID: input.providerID,
          result: await manager.cancelProviderAuthFlow(input),
        };
      }),
    disconnectProvider: (providerID: string) =>
      Effect.gen(function* () {
        const manager = getAuthFlowManager();
        yield* Effect.promise(() =>
          manager.cancelProviderAuthFlow({
            providerID,
            reason: "disconnect",
          })
        ).pipe(
          Effect.catchAllDefect(() => Effect.void),
        );

        yield* disconnectProvider(providerID);
        return {
          providerID,
          connected: false,
        };
      }),
  };
}
