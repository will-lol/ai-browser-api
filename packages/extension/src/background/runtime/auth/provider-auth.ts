import { browser } from "@wxt-dev/browser";
import * as Effect from "effect/Effect";
import {
  getAuth,
  removeAuth,
  setAuth,
} from "@/background/runtime/auth/auth-store";
import {
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import type { AuthRecord, AuthResult } from "@/background/runtime/auth/auth-store";
import type { RuntimeAuthFlowInstruction } from "@llm-bridge/contracts";
import { resolveAdapterForProvider } from "@/background/runtime/providers/adapters";
import {
  parseAuthMethodValues,
  toRuntimeAuthMethod,
} from "@/background/runtime/providers/adapters/schema";
import { wrapAuthPluginError } from "@/background/runtime/core/errors";
import { getModelsDevData } from "@/background/runtime/catalog/models-dev";
import { parseOAuthCallbackUrl } from "@/background/runtime/auth/oauth-util";
import { getProvider } from "@/background/runtime/catalog/provider-registry";
import { provideRuntimeSecurity } from "@/background/security/runtime-security";
import type { ProviderRuntimeInfo } from "@/background/runtime/catalog/provider-registry";

type AuthContextResolved = {
  providerID: string;
  provider: ProviderRuntimeInfo;
  auth?: AuthRecord;
};

function listResolvedAuthMethods(ctx: AuthContextResolved) {
  return Effect.gen(function* () {
    const modelsDev = yield* getModelsDevData();
    const adapter = resolveAdapterForProvider({
      providerID: ctx.providerID,
      source: modelsDev[ctx.providerID],
    });
    if (!adapter) return [];

    const definitions = yield* Effect.promise(() =>
      Promise.resolve(
        adapter.listAuthMethods({
          ...ctx,
          auth: ctx.auth,
        }),
      ),
    ).pipe(
      Effect.catchAllDefect((defect) =>
        Effect.fail(wrapAuthPluginError(defect, ctx.providerID, "auth.methods")),
      ),
    );
    return definitions.map((definition) => ({
      adapter,
      definition,
      method: toRuntimeAuthMethod(definition),
    }));
  });
}

function resolveAuthContext(
  providerID: string,
  options: {
    provider?: ProviderRuntimeInfo;
    auth?: AuthRecord;
  } = {},
) {
  return Effect.gen(function* () {
    const provider = options.provider ?? (yield* getProvider(providerID));
    if (!provider) {
      return yield* new RuntimeValidationError({
        message: `Provider ${providerID} not found`,
      });
    }
    const auth =
      options.auth ?? (yield* getAuth(providerID));
    return {
      providerID,
      provider,
      auth,
    };
  });
}

function persistAuth(
  providerID: string,
  input: {
    result: AuthResult;
  },
) {
  return setAuth(providerID, input.result);
}

export function listProviderAuthMethods(
  providerID: string,
  options: {
    provider?: ProviderRuntimeInfo;
    auth?: AuthRecord;
  } = {},
) {
  return provideRuntimeSecurity(Effect.gen(function* () {
    const ctx = yield* resolveAuthContext(providerID, options);
    const methods = yield* listResolvedAuthMethods(ctx);
    return methods.map((item) => item.method);
  }));
}

export function startProviderAuth(input: {
  providerID: string;
  methodID: string;
  values?: Record<string, string>;
  signal?: AbortSignal;
  onInstruction?: (
    instruction: RuntimeAuthFlowInstruction,
  ) => void | Promise<void>;
}) {
  return provideRuntimeSecurity(Effect.gen(function* () {
    const ctx = yield* resolveAuthContext(input.providerID);
    const methods = yield* listResolvedAuthMethods(ctx);
    const resolved = methods.find((item) => item.method.id === input.methodID);
    if (!resolved) {
      return yield* new RuntimeValidationError({
        message: `Auth method ${input.methodID} was not found for provider ${input.providerID}`,
      });
    }

    const parsedValues = parseAuthMethodValues(
      resolved.definition,
      input.values ?? {},
    );
    const result = yield* Effect.promise(() =>
      resolved.definition.authorize({
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
      }),
    ).pipe(
      Effect.catchAllDefect((defect) =>
        Effect.fail(
          wrapAuthPluginError(defect, input.providerID, "auth.authorize"),
        ),
      ),
    );

    yield* persistAuth(input.providerID, {
      result,
    });

    return {
      methodID: resolved.method.id,
      connected: true,
    };
  }));
}

export function disconnectProvider(providerID: string) {
  return provideRuntimeSecurity(removeAuth(providerID));
}
