import type { RuntimeEnvironmentApi } from "@llm-bridge/runtime-core";
import { getAuthFlowManager } from "@/background/runtime/auth/auth-flow-manager";
import { disconnectProvider } from "@/background/runtime/auth/provider-auth";
import { tryExtensionPromise } from "@/background/rpc/runtime-environment-shared";

export function makeRuntimeAuthEnvironment(): RuntimeEnvironmentApi["auth"] {
  return {
    openProviderAuthWindow: (providerID: string) =>
      tryExtensionPromise("auth.openProviderAuthWindow", () => {
        const manager = getAuthFlowManager();
        return manager.openProviderAuthWindow(providerID);
      }),
    getProviderAuthFlow: (providerID: string) =>
      tryExtensionPromise("auth.getProviderAuthFlow", async () => {
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
      tryExtensionPromise("auth.startProviderAuthFlow", async () => {
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
      tryExtensionPromise("auth.cancelProviderAuthFlow", async () => {
        const manager = getAuthFlowManager();
        return {
          providerID: input.providerID,
          result: await manager.cancelProviderAuthFlow(input),
        };
      }),
    disconnectProvider: (providerID: string) =>
      tryExtensionPromise("auth.disconnectProvider", async () => {
        const manager = getAuthFlowManager();
        await manager
          .cancelProviderAuthFlow({
            providerID,
            reason: "disconnect",
          })
          .catch(() => {
            // Ignore cancellation failures and continue disconnecting stored auth.
          });

        await disconnectProvider(providerID);
        return {
          providerID,
          connected: false,
        };
      }),
  };
}
