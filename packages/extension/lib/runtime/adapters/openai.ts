import { browser } from "@wxt-dev/browser";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import {
  RuntimeAuthProviderError,
  RuntimeUpstreamServiceError,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import {
  optionalMetadataString,
  parseOptionalMetadataObject,
} from "./auth-metadata";
import {
  optionalTrimmedStringSchema,
  parseProviderOptions,
} from "./provider-options";
import { createApiKeyMethod } from "./generic-factory";
import { wrapLanguageModel } from "./helpers";
import {
  mergeModelHeaders,
  mergeModelProviderOptions,
} from "./factory-language-model";
import type {
  AIAdapter,
  AdapterAuthorizeContext,
  ParsedAuthRecord,
  RuntimeAdapterContext,
} from "./types";
import type { AuthRecord, AuthResult } from "@/lib/runtime/auth-store";
import {
  waitForOAuthCallback,
  type OAuthWebRequestOnBeforeRequest,
} from "@/lib/runtime/oauth-browser-callback-util";
import {
  generatePKCE,
  generateState,
  sleep,
} from "@/lib/runtime/oauth-util";
import type {
  ProviderInfo,
  ProviderModelInfo,
} from "@/lib/runtime/provider-registry";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const CODEX_API_BASE = "https://chatgpt.com/backend-api/codex";
const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const CODEX_REDIRECT_URL_PATTERN = `${CODEX_REDIRECT_URI}*`;
const CODEX_CALLBACK_TIMEOUT_MS = 90_000;
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000;
const CODEX_DEFAULT_INSTRUCTIONS = "Follow the user's instructions.";
const CODEX_PROVIDER_ID = "openai";

type TokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

type OpenAIAuthMetadata = {
  accountId?: string;
};

const openAIProviderOptionsSchema = z.object({
  baseURL: optionalTrimmedStringSchema,
  name: optionalTrimmedStringSchema,
  organization: optionalTrimmedStringSchema,
  project: optionalTrimmedStringSchema,
});

type OpenAIProviderOptions = z.output<typeof openAIProviderOptionsSchema>;

const openAIAuthMetadataSchema = z.object({
  accountId: optionalMetadataString,
});

const tokenResponseSchema = z.object({
  id_token: z.string().optional(),
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().optional(),
});

const codexDeviceStartSchema = z.object({
  device_auth_id: z.string(),
  user_code: z.string(),
  interval: z.string(),
});

const codexDevicePollSchema = z.object({
  authorization_code: z.string(),
  code_verifier: z.string(),
});

function isCodexOAuth(
  auth?: ParsedAuthRecord<OpenAIAuthMetadata>,
): auth is Extract<ParsedAuthRecord<OpenAIAuthMetadata>, { type: "oauth" }> {
  return auth?.type === "oauth" && auth.methodType === "oauth";
}

function normalizeOpenAIAuthMetadata(
  auth?: AuthRecord,
): OpenAIAuthMetadata | undefined {
  return parseOptionalMetadataObject(openAIAuthMetadataSchema, auth?.metadata);
}

function parseOpenAIStoredAuth(
  auth?: AuthRecord,
): ParsedAuthRecord<OpenAIAuthMetadata> | undefined {
  if (!auth) return undefined;
  if (auth.type === "api") {
    return {
      ...auth,
      metadata: undefined,
    };
  }

  return {
    ...auth,
    metadata: normalizeOpenAIAuthMetadata(auth),
  };
}

function serializeOpenAIAuth(input: {
  result: AuthResult<OpenAIAuthMetadata>;
  method: {
    id: string;
    type: "oauth" | "pat" | "apikey";
  };
}) {
  if (input.result.type === "api") {
    return {
      ...input.result,
      metadata: undefined,
    };
  }

  const accountId =
    input.result.accountId ?? input.result.metadata?.accountId;

  return {
    ...input.result,
    metadata: parseOptionalMetadataObject(openAIAuthMetadataSchema, {
      accountId,
    }),
  };
}

async function parseOpenAIJson<TSchema extends z.ZodTypeAny>(input: {
  response: Response;
  schema: TSchema;
  operation: string;
}): Promise<z.output<TSchema>> {
  const payload = await input.response.json().catch(() => undefined);
  const result = input.schema.safeParse(payload);
  if (result.success) return result.data;

  throw codexAuthProviderError({
    operation: input.operation,
    message: "OpenAI authentication response was invalid.",
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new RuntimeAuthProviderError({
      providerID: CODEX_PROVIDER_ID,
      operation: "auth.abort",
      retryable: true,
      message: "Authentication canceled.",
    });
  }
}

function codexUpstreamError(input: {
  operation: string;
  statusCode: number;
  detail?: string;
}) {
  console.error("[adapter:openai] upstream auth request failed", {
    operation: input.operation,
    statusCode: input.statusCode,
    detail: input.detail?.slice(0, 500),
  });

  return new RuntimeUpstreamServiceError({
    providerID: CODEX_PROVIDER_ID,
    operation: input.operation,
    statusCode: input.statusCode,
    retryable:
      input.statusCode >= 500 ||
      input.statusCode === 429 ||
      input.statusCode === 408,
    message: "OpenAI authentication request failed.",
  });
}

function codexAuthProviderError(input: {
  operation: string;
  message: string;
  retryable?: boolean;
}) {
  return new RuntimeAuthProviderError({
    providerID: CODEX_PROVIDER_ID,
    operation: input.operation,
    retryable: input.retryable ?? false,
    message: input.message,
  });
}

function decodeJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  try {
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractAccountId(tokens: TokenResponse) {
  const candidates = [tokens.id_token, tokens.access_token].filter(
    (token): token is string => Boolean(token),
  );
  for (const token of candidates) {
    const claims = decodeJwtPayload(token);
    if (!claims) continue;

    const direct =
      typeof claims.chatgpt_account_id === "string"
        ? claims.chatgpt_account_id
        : undefined;
    if (direct) return direct;

    const nested = claims["https://api.openai.com/auth"];
    if (nested && typeof nested === "object") {
      const next = (nested as Record<string, unknown>).chatgpt_account_id;
      if (typeof next === "string") return next;
    }

    if (Array.isArray(claims.organizations)) {
      const first = claims.organizations[0];
      if (
        first &&
        typeof first === "object" &&
        typeof (first as Record<string, unknown>).id === "string"
      ) {
        return (first as Record<string, string>).id;
      }
    }
  }

  return undefined;
}

function buildCodexDeviceInstruction(input: {
  code: string;
  url: string;
  autoOpened: boolean;
}) {
  return {
    kind: "device_code" as const,
    title: "Enter the device code to continue",
    message:
      "Open the verification page and enter this code to finish signing in.",
    code: input.code,
    url: input.url,
    autoOpened: input.autoOpened,
  };
}

function buildOpenAISettings(input: {
  providerID: string;
  providerOptions: OpenAIProviderOptions;
  headers?: Record<string, string>;
  baseURL?: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  fetch?: typeof fetch;
}): Parameters<typeof createOpenAI>[0] {
  return {
    baseURL: input.baseURL ?? input.providerOptions.baseURL,
    apiKey: input.apiKey,
    headers: {
      ...(input.headers ?? {}),
      ...(input.extraHeaders ?? {}),
    },
    fetch: input.fetch,
    name: input.providerOptions.name ?? input.providerID,
    organization: input.providerOptions.organization,
    project: input.providerOptions.project,
  };
}

function buildCodexBrowserInstruction(input: {
  url: string;
  autoOpened: boolean;
}) {
  return {
    kind: "notice" as const,
    title: "Complete OpenAI sign in",
    message: input.autoOpened
      ? "Finish the sign-in flow in the opened browser tab. We'll continue automatically."
      : "Open the sign-in URL to continue. We'll continue automatically after the callback is captured.",
    url: input.url,
    autoOpened: input.autoOpened,
  };
}

function buildCodexAuthorizationURL(input: {
  codeChallenge: string;
  state: string;
}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: CODEX_REDIRECT_URI,
    scope: "openid profile email offline_access",
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: input.state,
    originator: "codex_cli_rs",
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

function isCodexOAuthCallbackURL(url: string) {
  return url.startsWith(CODEX_REDIRECT_URI);
}

async function waitForCodexOAuthCallback(
  signal?: AbortSignal,
  onBeforeRequest: OAuthWebRequestOnBeforeRequest | undefined = browser
    ?.webRequest?.onBeforeRequest,
) {
  return waitForOAuthCallback({
    signal,
    onBeforeRequest,
    urlPattern: CODEX_REDIRECT_URL_PATTERN,
    matchesUrl: isCodexOAuthCallbackURL,
    timeoutMs: CODEX_CALLBACK_TIMEOUT_MS,
    unsupportedErrorMessage:
      "Codex browser OAuth is unavailable: webRequest callback interception is not supported in this browser. Use ChatGPT Pro/Plus (headless) device auth instead.",
    timeoutErrorMessage:
      "Timed out waiting for Codex OAuth callback on http://localhost:1455/auth/callback.",
    registerListenerErrorPrefix:
      "Failed to register Codex OAuth callback listener",
  });
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  verifier: string,
) {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw codexUpstreamError({
      operation: "oauth.exchangeCodeForTokens",
      statusCode: response.status,
      detail,
    });
  }

  return parseOpenAIJson({
    response,
    schema: tokenResponseSchema,
    operation: "oauth.exchangeCodeForTokens.parse",
  });
}

async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw codexUpstreamError({
      operation: "oauth.refreshAccessToken",
      statusCode: response.status,
      detail,
    });
  }

  return parseOpenAIJson({
    response,
    schema: tokenResponseSchema,
    operation: "oauth.refreshAccessToken.parse",
  });
}

async function authorizeBrowser(input: AdapterAuthorizeContext) {
  throwIfAborted(input.signal);
  const pkce = await generatePKCE();
  const state = generateState();
  const authorizationURL = buildCodexAuthorizationURL({
    codeChallenge: pkce.challenge,
    state,
  });

  let authTabID: number | undefined;
  let autoOpened = false;
  await browser.tabs
    .create({
      url: authorizationURL,
      active: true,
    })
    .then((tab) => {
      authTabID = tab.id;
      autoOpened = true;
    })
    .catch(() => {
      // Surface the auth URL in popup instructions when tab opening fails.
    });

  await input.authFlow.publish(
    buildCodexBrowserInstruction({
      url: authorizationURL,
      autoOpened,
    }),
  );

  let callbackUrl = "";
  try {
    callbackUrl = await waitForCodexOAuthCallback(input.signal);
  } finally {
    if (typeof authTabID === "number") {
      await browser.tabs.remove(authTabID).catch(() => {
        // Ignore tab cleanup errors once callback handling has ended.
      });
    }
  }

  const parsed = input.oauth.parseCallback(callbackUrl);
  if (parsed.error) {
    throw codexAuthProviderError({
      operation: "oauth.authorizeBrowser",
      message: "OpenAI OAuth authorization failed.",
    });
  }
  if (!parsed.code) {
    throw new RuntimeValidationError({
      message: "Missing authorization code",
    });
  }
  if (parsed.state !== state) {
    throw new RuntimeValidationError({
      message: "OAuth state mismatch",
    });
  }

  const tokens = await exchangeCodeForTokens(
    parsed.code,
    CODEX_REDIRECT_URI,
    pkce.verifier,
  );
  const accountId = extractAccountId(tokens);

  return {
    type: "oauth" as const,
    methodID: "oauth-browser" as const,
    methodType: "oauth" as const,
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expiresAt: input.runtime.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId,
    metadata: accountId ? { accountId } : undefined,
  };
}

async function authorizeDevice(input: AdapterAuthorizeContext) {
  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "llm-bridge",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw codexUpstreamError({
      operation: "oauth.authorizeDevice.start",
      statusCode: response.status,
      detail,
    });
  }

  const data = await parseOpenAIJson({
    response,
    schema: codexDeviceStartSchema,
    operation: "oauth.authorizeDevice.start.parse",
  });

  const verificationUrl = `${ISSUER}/codex/device`;
  let autoOpened = false;
  await browser.tabs
    .create({
      url: verificationUrl,
    })
    .then(() => {
      autoOpened = true;
    })
    .catch(() => {
      // Ignore tab creation errors and continue polling.
    });

  await input.authFlow.publish(
    buildCodexDeviceInstruction({
      code: data.user_code,
      url: verificationUrl,
      autoOpened,
    }),
  );

  const intervalMs = Math.max(parseInt(data.interval, 10) || 5, 1) * 1000;
  const deadline = Date.now() + 5 * 60_000;

  while (Date.now() < deadline) {
    throwIfAborted(input.signal);
    const tokenPollResponse = await fetch(
      `${ISSUER}/api/accounts/deviceauth/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "llm-bridge",
        },
        body: JSON.stringify({
          device_auth_id: data.device_auth_id,
          user_code: data.user_code,
        }),
      },
    );

    if (tokenPollResponse.ok) {
      const payload = await parseOpenAIJson({
        response: tokenPollResponse,
        schema: codexDevicePollSchema,
        operation: "oauth.authorizeDevice.poll.parse",
      });

      const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: payload.authorization_code,
          redirect_uri: `${ISSUER}/deviceauth/callback`,
          client_id: CLIENT_ID,
          code_verifier: payload.code_verifier,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const detail = await tokenResponse.text().catch(() => "");
        throw codexUpstreamError({
          operation: "oauth.authorizeDevice.exchangeToken",
          statusCode: tokenResponse.status,
          detail,
        });
      }

      const tokens = await parseOpenAIJson({
        response: tokenResponse,
        schema: tokenResponseSchema,
        operation: "oauth.authorizeDevice.exchangeToken.parse",
      });
      const accountId = extractAccountId(tokens);
      return {
        type: "oauth" as const,
        methodID: "oauth-device" as const,
        methodType: "oauth" as const,
        access: tokens.access_token,
        refresh: tokens.refresh_token,
        expiresAt: input.runtime.now() + (tokens.expires_in ?? 3600) * 1000,
        accountId,
        metadata: accountId ? { accountId } : undefined,
      };
    }

    if (tokenPollResponse.status !== 403 && tokenPollResponse.status !== 404) {
      const detail = await tokenPollResponse.text().catch(() => "");
      throw codexUpstreamError({
        operation: "oauth.authorizeDevice.poll",
        statusCode: tokenPollResponse.status,
        detail,
      });
    }

    await sleep(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS);
    throwIfAborted(input.signal);
  }

  throw codexAuthProviderError({
    operation: "oauth.authorizeDevice.poll",
    message: "Codex device authorization timed out.",
    retryable: true,
  });
}

function buildCodexChatHeaders(
  headers: Record<string, string>,
  sessionID: string,
) {
  return {
    ...headers,
    originator: "codex_cli_rs",
    "OpenAI-Beta": "responses=experimental",
    session_id: sessionID,
    "User-Agent": "llm-bridge",
  };
}

function buildCodexOAuthProvider(provider: ProviderInfo) {
  const allowedModels = new Set([
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
    "gpt-5.4",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.1-codex",
  ]);

  const models: Record<string, ProviderModelInfo> = {};
  for (const [modelID, model] of Object.entries(provider.models)) {
    if (!modelID.includes("codex") && !allowedModels.has(modelID)) continue;
    models[modelID] = {
      ...model,
      api: {
        ...model.api,
        url: CODEX_API_BASE,
        npm: "@ai-sdk/openai",
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    };
  }

  if (!models["gpt-5.3-codex"]) {
    models["gpt-5.3-codex"] = {
      id: "gpt-5.3-codex",
      providerID: "openai",
      name: "GPT-5.3 Codex",
      family: "gpt-codex",
      status: "active",
      release_date: "2026-02-05",
      api: {
        id: "gpt-5.3-codex",
        url: CODEX_API_BASE,
        npm: "@ai-sdk/openai",
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      limit: {
        context: 400_000,
        input: 272_000,
        output: 128_000,
      },
      options: {},
      headers: {},
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
      variants: {},
    };
  }

  return {
    ...provider,
    models,
  };
}

export async function resolveOpenAIExecutionState(
  context: RuntimeAdapterContext<OpenAIAuthMetadata>,
) {
  if (!context.auth) {
    return {
      apiKey: undefined,
      baseURL: undefined,
      headers: {},
    };
  }

  if (!isCodexOAuth(context.auth)) {
    return {
      apiKey: context.auth.type === "api" ? context.auth.key : undefined,
      baseURL: undefined,
      headers: {},
    };
  }

  let access = context.auth.access;
  let refresh = context.auth.refresh;
  let expiresAt = context.auth.expiresAt;
  let effectiveAccountId =
    context.auth.accountId ?? context.auth.metadata?.accountId;

  if (
    refresh &&
    (!expiresAt || expiresAt <= context.runtime.now() + 60_000)
  ) {
    const refreshed = await refreshAccessToken(refresh);
    effectiveAccountId = extractAccountId(refreshed) ?? effectiveAccountId;
    access = refreshed.access_token;
    refresh = refreshed.refresh_token;
    expiresAt = context.runtime.now() + (refreshed.expires_in ?? 3600) * 1000;

    await context.authStore.set({
      type: "oauth",
      access,
      refresh,
      expiresAt,
      accountId: effectiveAccountId,
      methodID: context.auth.methodID,
      methodType: context.auth.methodType,
      metadata: effectiveAccountId ? { accountId: effectiveAccountId } : undefined,
    });
  }

  if (!effectiveAccountId) {
    console.warn(
      "[adapter:openai] oauth accountId is missing; Codex requests may fail until token claims include chatgpt_account_id.",
    );
  }

  return {
    baseURL: CODEX_API_BASE,
    apiKey: access,
    headers: {
      ...(effectiveAccountId
        ? { "chatgpt-account-id": effectiveAccountId }
        : {}),
    },
  };
}

function wrapCodexCallOptions(
  options: LanguageModelV3CallOptions,
  sessionID: string,
) {
  const withProviderOptions = mergeModelProviderOptions(options, "openai", {
    store: false,
    instructions: CODEX_DEFAULT_INSTRUCTIONS,
  });

  return mergeModelHeaders(
    withProviderOptions,
    buildCodexChatHeaders(
      (withProviderOptions.headers as Record<string, string> | undefined) ?? {},
      sessionID,
    ),
  );
}

export const openaiAdapter: AIAdapter<OpenAIAuthMetadata> = {
  key: "provider:openai",
  displayName: "OpenAI",
  match: {
    providerIDs: ["openai"],
  },
  auth: {
    parseStoredAuth: parseOpenAIStoredAuth,
    serializeAuth: serializeOpenAIAuth,
    async methods(ctx) {
      return [
        createApiKeyMethod(ctx),
        {
          id: "oauth-browser",
          type: "oauth",
          label: "ChatGPT Pro/Plus (browser)",
          authorize: authorizeBrowser,
        },
        {
          id: "oauth-device",
          type: "oauth",
          label: "ChatGPT Pro/Plus (headless)",
          authorize: authorizeDevice,
        },
      ];
    },
  },
  async patchCatalog(ctx, provider) {
    if (!isCodexOAuth(ctx.auth)) return provider;
    return buildCodexOAuthProvider(provider);
  },
  async createModel(context) {
    const providerOptions = parseProviderOptions(
      openAIProviderOptionsSchema,
      context.provider.options,
    );
    const execution = await resolveOpenAIExecutionState(context);
    const provider = createOpenAI(
      buildOpenAISettings({
        providerID: context.providerID,
        providerOptions,
        headers: context.model.headers,
        baseURL: execution.baseURL,
        apiKey: execution.apiKey,
        extraHeaders: execution.headers,
      }),
    );
    const baseModel = provider.responses(context.model.api.id);

    if (!isCodexOAuth(context.auth)) {
      return baseModel;
    }

    return wrapLanguageModel(baseModel, async (options) =>
      wrapCodexCallOptions(options, context.sessionID),
    );
  },
};
