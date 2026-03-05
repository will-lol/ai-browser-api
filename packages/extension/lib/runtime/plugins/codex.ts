import { browser } from "@wxt-dev/browser";
import { setAuth } from "@/lib/runtime/auth-store";
import type { AuthRecord } from "@/lib/runtime/auth-store";
import type {
  PluginAuthorizeContext,
  RuntimePlugin,
} from "@/lib/runtime/plugin-manager";
import {
  generatePKCE,
  generateState,
  sleep,
} from "@/lib/runtime/plugins/oauth-util";
import {
  type OAuthWebRequestOnBeforeRequest,
  waitForOAuthCallback,
} from "@/lib/runtime/plugins/oauth-browser-callback-util";
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

type TokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

type RequestSummary = {
  model?: string;
  stream?: boolean;
  store?: boolean;
  hasInstructions?: boolean;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Authentication canceled");
  }
}

function summarizeCodexRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): RequestSummary {
  const body = init?.body;
  if (typeof body !== "string") return {};

  try {
    const parsed = JSON.parse(body) as {
      model?: unknown;
      stream?: unknown;
      store?: unknown;
      instructions?: unknown;
    };
    return {
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      stream: typeof parsed.stream === "boolean" ? parsed.stream : undefined,
      store: typeof parsed.store === "boolean" ? parsed.store : undefined,
      hasInstructions:
        typeof parsed.instructions === "string" &&
        parsed.instructions.trim().length > 0,
    };
  } catch {
    return {};
  }
}

function toUrlString(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createCodexDebugFetch(): typeof fetch {
  return async (input, init) => {
    const url = toUrlString(input);
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");

    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    const initHeaders = new Headers(init?.headers);
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });

    const requestSummary = summarizeCodexRequest(input, init);
    console.info("[builtin-codex-auth] request", {
      method,
      url,
      model: requestSummary.model ?? null,
      stream: requestSummary.stream ?? null,
      store: requestSummary.store ?? null,
      hasInstructions: requestSummary.hasInstructions ?? null,
      hasAuthorization: Boolean(headers.get("authorization")),
      hasAccountHeader: Boolean(headers.get("chatgpt-account-id")),
      originator: headers.get("originator") ?? null,
      openAIBeta: headers.get("openai-beta") ?? null,
      accept: headers.get("accept") ?? null,
      sessionID: headers.get("session_id") ?? null,
    });

    const response = await fetch(input, init);

    if (!response.ok) {
      const detail = await response
        .clone()
        .text()
        .catch(() => "");
      console.error("[builtin-codex-auth] response.error", {
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type") ?? null,
        detail: detail.slice(0, 500),
      });
      return response;
    }

    console.info("[builtin-codex-auth] response.ok", {
      method,
      url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? null,
    });
    return response;
  };
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
    (token): token is string => !!token,
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
  return await waitForOAuthCallback({
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
    throw new Error(
      `Codex token exchange failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  return (await response.json()) as TokenResponse;
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
    throw new Error(
      `Codex token refresh failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  return (await response.json()) as TokenResponse;
}

async function authorizeBrowser(input: PluginAuthorizeContext) {
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
    throw new Error(
      `Codex OAuth failed: ${parsed.errorDescription ?? parsed.error}`,
    );
  }
  if (!parsed.code) throw new Error("Missing authorization code");
  if (parsed.state !== state) {
    throw new Error("OAuth state mismatch");
  }

  const tokens = await exchangeCodeForTokens(
    parsed.code,
    CODEX_REDIRECT_URI,
    pkce.verifier,
  );
  const accountId = extractAccountId(tokens);

  return {
    type: "oauth" as const,
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expiresAt: input.runtime.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId,
    metadata: {
      authMode: "codex_oauth",
      ...(accountId ? { accountId } : {}),
    },
  };
}

async function authorizeDevice(input: PluginAuthorizeContext) {
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
    throw new Error(
      `Failed to start Codex device auth (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    device_auth_id: string;
    user_code: string;
    interval: string;
  };

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
  const signal = input.signal;
  const deadline = Date.now() + 5 * 60_000;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
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
      const payload = (await tokenPollResponse.json()) as {
        authorization_code: string;
        code_verifier: string;
      };

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
        throw new Error(
          `Codex device token exchange failed (${tokenResponse.status}): ${detail.slice(0, 300)}`,
        );
      }

      const tokens = (await tokenResponse.json()) as TokenResponse;
      const accountId = extractAccountId(tokens);
      return {
        type: "oauth" as const,
        access: tokens.access_token,
        refresh: tokens.refresh_token,
        expiresAt: input.runtime.now() + (tokens.expires_in ?? 3600) * 1000,
        accountId,
        metadata: {
          authMode: "codex_oauth",
          ...(accountId ? { accountId } : {}),
        },
      };
    }

    if (tokenPollResponse.status !== 403 && tokenPollResponse.status !== 404) {
      const detail = await tokenPollResponse.text().catch(() => "");
      throw new Error(
        `Codex device auth failed (${tokenPollResponse.status}): ${detail.slice(0, 300)}`,
      );
    }

    await sleep(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS);
    throwIfAborted(signal);
  }

  throw new Error(
    `Codex device authorization timed out. Enter code: ${data.user_code}`,
  );
}

function buildCodexOAuthProvider(provider: ProviderInfo) {
  const allowedModels = new Set([
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
    "gpt-5.2",
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

function isCodexOAuth(
  auth?: AuthRecord,
): auth is Extract<AuthRecord, { type: "oauth" }> {
  return auth?.type === "oauth" && auth.metadata?.authMode === "codex_oauth";
}

function buildCodexChatHeaders(
  headers: Record<string, string>,
  sessionID: string,
): Record<string, string> {
  return {
    ...headers,
    originator: "codex_cli_rs",
    "OpenAI-Beta": "responses=experimental",
    session_id: sessionID,
    "User-Agent": "llm-bridge",
  };
}

export const codexAuthPlugin: RuntimePlugin = {
  id: "builtin-codex-auth",
  name: "Builtin Codex Auth",
  supportedProviders: ["openai"],
  hooks: {
    auth: {
      provider: "openai",
      async methods() {
        return [
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
      async loader(auth, _provider, ctx) {
        if (!isCodexOAuth(auth)) return {};

        let access = auth.access;
        let refresh = auth.refresh;
        let expiresAt = auth.expiresAt;
        const accountId = auth.accountId ?? auth.metadata?.accountId;
        if (!accountId) {
          console.warn(
            "[builtin-codex-auth] oauth accountId is missing; Codex requests may fail until token claims include chatgpt_account_id.",
          );
        }

        if (refresh && (!expiresAt || expiresAt <= Date.now() + 60_000)) {
          const refreshed = await refreshAccessToken(refresh);
          const nextAccountId = extractAccountId(refreshed) ?? accountId;
          access = refreshed.access_token;
          refresh = refreshed.refresh_token;
          expiresAt = Date.now() + (refreshed.expires_in ?? 3600) * 1000;

          await setAuth(ctx.providerID, {
            type: "oauth",
            access,
            refresh,
            expiresAt,
            accountId: nextAccountId,
            metadata: {
              ...(auth.metadata ?? {}),
              authMode: "codex_oauth",
              ...(nextAccountId ? { accountId: nextAccountId } : {}),
            },
          });
        }

        return {
          transport: {
            baseURL: CODEX_API_BASE,
            apiKey: access,
            authType: "bearer",
            fetch: createCodexDebugFetch(),
            headers: {
              ...(accountId ? { "chatgpt-account-id": accountId } : {}),
            },
          },
        };
      },
    },
    provider: {
      async patchProvider(ctx, provider) {
        if (!isCodexOAuth(ctx.auth)) return undefined;
        return buildCodexOAuthProvider(provider);
      },
      async requestOptions(ctx, _options) {
        if (ctx.providerID !== "openai" || !isCodexOAuth(ctx.auth))
          return undefined;
        return {
          strategy: "merge",
          value: {
            store: false,
            instructions: CODEX_DEFAULT_INSTRUCTIONS,
          },
        };
      },
    },
    chat: {
      async headers(ctx, headers) {
        if (ctx.providerID !== "openai" || !isCodexOAuth(ctx.auth))
          return undefined;
        return {
          strategy: "merge",
          value: buildCodexChatHeaders(headers, ctx.sessionID),
        };
      },
    },
  },
};
