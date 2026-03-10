import { browser } from "@wxt-dev/browser";
import { getAuth, removeAuth, setAuth } from "@/background/runtime/auth-store";
import {
  RuntimeValidationError,
  isRuntimeRpcError,
} from "@llm-bridge/contracts";
import type { AuthRecord, AuthResult } from "@/background/runtime/auth-store";
import type { RuntimeAuthFlowInstruction } from "@llm-bridge/contracts";
import { resolveAdapterForProvider } from "@/background/runtime/adapters";
import {
  parseAuthMethodValues,
  toRuntimeAuthMethod,
} from "@/background/runtime/adapters/schema";
import type {
  ResolvedAuthMethod,
  RuntimeAuthMethod,
} from "@/background/runtime/adapters/types";
import { wrapAuthPluginError, wrapExtensionError } from "@/background/runtime/errors";
import { getModelsDevData } from "@/background/runtime/models-dev";
import { parseOAuthCallbackUrl } from "@/background/runtime/oauth-util";
import { getProvider } from "@/background/runtime/provider-registry";
import type { ProviderRuntimeInfo } from "@/background/runtime/provider-registry";

type AuthContextResolved = {
  providerID: string;
  provider: ProviderRuntimeInfo;
  auth?: AuthRecord;
};

type StartProviderAuthResult = {
  methodID: string;
  connected: true;
};

async function listResolvedAuthMethods(
  ctx: AuthContextResolved,
): Promise<ResolvedAuthMethod[]> {
  const modelsDev = await getModelsDevData();
  const adapter = resolveAdapterForProvider({
    providerID: ctx.providerID,
    source: modelsDev[ctx.providerID],
  });
  if (!adapter) return [];

  const definitions = await adapter.listAuthMethods({
    ...ctx,
    auth: ctx.auth,
  });
  return definitions.map((definition) => ({
    adapter,
    definition,
    method: toRuntimeAuthMethod(definition),
  }));
}

async function resolveAuthContext(
  providerID: string,
  options: {
    provider?: ProviderRuntimeInfo;
    auth?: AuthRecord;
  } = {},
): Promise<AuthContextResolved> {
  const provider = options.provider ?? (await getProvider(providerID));
  if (!provider) {
    throw new RuntimeValidationError({
      message: `Provider ${providerID} not found`,
    });
  }
  const auth = options.auth ?? (await getAuth(providerID));
  return {
    providerID,
    provider,
    auth,
  };
}

async function persistAuth(
  providerID: string,
  input: {
    result: AuthResult;
  },
) {
  await setAuth(providerID, input.result);
}

export async function listProviderAuthMethods(
  providerID: string,
  options: {
    provider?: ProviderRuntimeInfo;
    auth?: AuthRecord;
  } = {},
): Promise<RuntimeAuthMethod[]> {
  try {
    const ctx = await resolveAuthContext(providerID, options);
    const methods = await listResolvedAuthMethods(ctx);
    return methods.map((item) => item.method);
  } catch (error) {
    if (isRuntimeRpcError(error)) throw error;
    throw wrapAuthPluginError(error, providerID, "auth.methods");
  }
}

export async function startProviderAuth(input: {
  providerID: string;
  methodID: string;
  values?: Record<string, string>;
  signal?: AbortSignal;
  onInstruction?: (
    instruction: RuntimeAuthFlowInstruction,
  ) => void | Promise<void>;
}): Promise<StartProviderAuthResult> {
  try {
    const ctx = await resolveAuthContext(input.providerID);
    const methods = await listResolvedAuthMethods(ctx);
    const resolved = methods.find((item) => item.method.id === input.methodID);
    if (!resolved) {
      throw new RuntimeValidationError({
        message: `Auth method ${input.methodID} was not found for provider ${input.providerID}`,
      });
    }

    const parsedValues = parseAuthMethodValues(
      resolved.definition,
      input.values ?? {},
    );
    const result = await resolved.definition.authorize({
      ...ctx,
      auth: ctx.auth,
      values: parsedValues,
      signal: input.signal,
      oauth: {
        getRedirectURL(path = "oauth") {
          if (!browser.identity?.getRedirectURL) {
            throw new Error("Browser OAuth flow is unavailable");
          }
          return browser.identity.getRedirectURL(path);
        },
        async launchWebAuthFlow(url: string) {
          if (!browser.identity?.launchWebAuthFlow) {
            throw new Error("Browser OAuth flow is unavailable");
          }

          const callbackUrl = await browser.identity.launchWebAuthFlow({
            url,
            interactive: true,
          });

          if (!callbackUrl) {
            throw new Error("OAuth flow did not return a callback URL");
          }

          return callbackUrl;
        },
        parseCallback(url: string) {
          return parseOAuthCallbackUrl(url);
        },
      },
      authFlow: {
        async publish(instruction) {
          if (!input.onInstruction) return;
          await input.onInstruction(instruction);
        },
      },
      runtime: {
        now: () => Date.now(),
      },
    });

    await persistAuth(input.providerID, {
      result,
    });

    return {
      methodID: resolved.method.id,
      connected: true,
    };
  } catch (error) {
    if (isRuntimeRpcError(error)) throw error;
    throw wrapAuthPluginError(error, input.providerID, "auth.authorize");
  }
}

export async function disconnectProvider(providerID: string) {
  try {
    await removeAuth(providerID);
  } catch (error) {
    if (isRuntimeRpcError(error)) throw error;
    throw wrapExtensionError(error, "auth.disconnect");
  }
}
