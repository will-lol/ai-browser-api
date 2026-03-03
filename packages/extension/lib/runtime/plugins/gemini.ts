import { browser } from "@wxt-dev/browser";
import { setAuth } from "@/lib/runtime/auth-store";
import {
  generatePKCE,
  generateState,
} from "@/lib/runtime/plugins/oauth-util";
import type { RuntimePlugin } from "@/lib/runtime/plugin-manager";

const GEMINI_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const GEMINI_CLIENT_SECRET = "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";
const GEMINI_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];
const GEMINI_REDIRECT_URI = "http://localhost:8085/oauth2callback";
const GEMINI_REDIRECT_URL_PATTERN = `${GEMINI_REDIRECT_URI}*`;
const GEMINI_CALLBACK_TIMEOUT_MS = 90_000;

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

function getGeminiClientSecret() {
  if (!GEMINI_CLIENT_SECRET) {
    throw new Error("Gemini OAuth client secret is missing.");
  }
  return GEMINI_CLIENT_SECRET;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function waitForGeminiOAuthCallback(signal?: AbortSignal) {
  if (!browser.webRequest?.onBeforeRequest) {
    throw new Error(
      "Gemini OAuth callback interception is unavailable: webRequest is not supported in this browser.",
    );
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      finalize(() =>
        reject(
          new Error(
            "Timed out waiting for Gemini OAuth callback on http://localhost:8085/oauth2callback.",
          ),
        ),
      );
    }, GEMINI_CALLBACK_TIMEOUT_MS);

    const listener: Parameters<
      typeof browser.webRequest.onBeforeRequest.addListener
    >[0] = (details) => {
      if (details.type !== "main_frame") return undefined;
      if (!details.url.startsWith(GEMINI_REDIRECT_URI)) return undefined;

      console.info("[builtin-gemini-auth] oauth callback intercepted", {
        hasQuery: details.url.includes("?"),
      });
      finalize(() => resolve(details.url));
      return undefined;
    };

    const onAbort = () => {
      finalize(() => reject(new Error("Authentication canceled")));
    };

    const finalize = (action: () => void) => {
      if (settled) return;
      settled = true;

      clearTimeout(timeoutId);
      try {
        browser.webRequest.onBeforeRequest.removeListener(listener);
      } catch {
        // Ignore listener teardown errors while auth is ending.
      }
      signal?.removeEventListener("abort", onAbort);
      action();
    };

    try {
      browser.webRequest.onBeforeRequest.addListener(listener, {
        urls: [GEMINI_REDIRECT_URL_PATTERN],
        types: ["main_frame"],
      });
      console.info("[builtin-gemini-auth] oauth callback listener armed", {
        pattern: GEMINI_REDIRECT_URL_PATTERN,
      });
    } catch (error) {
      finalize(() =>
        reject(
          new Error(
            `Failed to register Gemini OAuth callback listener: ${toErrorMessage(error)}`,
          ),
        ),
      );
      return;
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri: string,
  clientSecret: string,
) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Gemini OAuth exchange failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  return (await response.json()) as GoogleTokenResponse;
}

async function refreshAccessToken(refreshToken: string, clientSecret: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: GEMINI_CLIENT_ID,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Gemini token refresh failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  return (await response.json()) as GoogleTokenResponse;
}

async function resolveUserEmail(accessToken: string) {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (!response.ok) return undefined;
  const payload = (await response.json()) as { email?: string };
  return payload.email;
}

function isGeminiOAuth(metadata?: Record<string, string>) {
  return metadata?.authMode === "gemini_oauth";
}

export const geminiOAuthPlugin: RuntimePlugin = {
  id: "builtin-gemini-auth",
  name: "Builtin Gemini OAuth",
  supportedProviders: ["google"],
  hooks: {
    auth: {
      provider: "google",
      async methods() {
        return [
          {
            id: "oauth",
            type: "oauth",
            label: "OAuth with Google (Gemini CLI)",
            fields: [
              {
                type: "text",
                key: "projectId",
                label: "Google Cloud project ID (optional)",
                placeholder: "my-gcp-project",
                required: false,
              },
            ],
            async authorize(input) {
              const clientSecret = getGeminiClientSecret();
              const redirectUri = GEMINI_REDIRECT_URI;
              const pkce = await generatePKCE();
              const state = generateState();

              const url = new URL(
                "https://accounts.google.com/o/oauth2/v2/auth",
              );
              url.searchParams.set("client_id", GEMINI_CLIENT_ID);
              url.searchParams.set("response_type", "code");
              url.searchParams.set("redirect_uri", redirectUri);
              url.searchParams.set("scope", GEMINI_SCOPES.join(" "));
              url.searchParams.set("code_challenge", pkce.challenge);
              url.searchParams.set("code_challenge_method", "S256");
              url.searchParams.set("state", state);
              url.searchParams.set("access_type", "offline");
              url.searchParams.set("prompt", "consent");
              url.hash = "llm-bridge";

              console.info("[builtin-gemini-auth] oauth authorize start", {
                providerID: input.providerID,
                redirectUri,
                authURLOrigin: url.origin,
              });

              let authTabId: number | undefined;
              try {
                const tab = await browser.tabs.create({
                  url: url.toString(),
                  active: true,
                });
                authTabId = tab.id;
                console.info("[builtin-gemini-auth] oauth tab opened", {
                  tabID: authTabId ?? null,
                });
              } catch (error) {
                throw new Error(
                  `Failed to open Google OAuth tab: ${toErrorMessage(error)}`,
                  { cause: error },
                );
              }

              let callbackUrl: string;
              try {
                callbackUrl = await waitForGeminiOAuthCallback(input.signal);
              } catch (error) {
                console.error(
                  "[builtin-gemini-auth] oauth callback wait failed",
                  {
                    error: toErrorMessage(error),
                  },
                );
                throw error;
              } finally {
                if (typeof authTabId === "number") {
                  await browser.tabs.remove(authTabId).catch(() => {
                    // Ignore tab close failures if user already closed it.
                  });
                  console.info("[builtin-gemini-auth] oauth tab closed", {
                    tabID: authTabId,
                  });
                }
              }

              const parsed = input.oauth.parseCallback(callbackUrl);
              console.info("[builtin-gemini-auth] oauth callback parsed", {
                hasCode: Boolean(parsed.code),
                hasState: Boolean(parsed.state),
                error: parsed.error ?? null,
                hasErrorDescription: Boolean(parsed.errorDescription),
              });

              if (parsed.error) {
                throw new Error(
                  `Google OAuth failed: ${parsed.errorDescription ?? parsed.error}`,
                );
              }
              if (!parsed.code)
                throw new Error("Missing Google authorization code");
              if (parsed.state && parsed.state !== state) {
                throw new Error("OAuth state mismatch");
              }

              let tokens: GoogleTokenResponse;
              try {
                console.info(
                  "[builtin-gemini-auth] exchanging authorization code",
                );
                tokens = await exchangeAuthorizationCode(
                  parsed.code,
                  pkce.verifier,
                  redirectUri,
                  clientSecret,
                );
                console.info("[builtin-gemini-auth] token exchange succeeded", {
                  expiresIn: tokens.expires_in,
                  hasRefreshToken: Boolean(tokens.refresh_token),
                });
              } catch (error) {
                console.error(
                  "[builtin-gemini-auth] token exchange failed",
                  {
                    error: toErrorMessage(error),
                  },
                );
                throw error;
              }
              if (!tokens.refresh_token) {
                throw new Error(
                  "Missing refresh token in Google OAuth response",
                );
              }

              const projectId = input.values.projectId?.trim() || undefined;
              const email = await resolveUserEmail(tokens.access_token);
              return {
                type: "oauth",
                access: tokens.access_token,
                refresh: tokens.refresh_token,
                expiresAt: Date.now() + tokens.expires_in * 1000,
                metadata: {
                  authMode: "gemini_oauth",
                  ...(email ? { email } : {}),
                  ...(projectId ? { projectId } : {}),
                },
              };
            },
          },
        ];
      },
      async loader(auth, _provider, ctx) {
        if (auth?.type !== "oauth" || !isGeminiOAuth(auth.metadata)) return {};

        let access = auth.access;
        let refresh = auth.refresh;
        let expiresAt = auth.expiresAt;

        if (refresh && (!expiresAt || expiresAt <= Date.now() + 60_000)) {
          const refreshed = await refreshAccessToken(
            refresh,
            getGeminiClientSecret(),
          );
          access = refreshed.access_token;
          refresh = refreshed.refresh_token ?? refresh;
          expiresAt = Date.now() + refreshed.expires_in * 1000;

          await setAuth(ctx.providerID, {
            type: "oauth",
            access,
            refresh,
            expiresAt,
            metadata: {
              ...(auth.metadata ?? {}),
              authMode: "gemini_oauth",
            },
          });
        }

        return {
          $apiKey: access,
          $authType: "bearer",
          $headers: {
            "X-Goog-Api-Client": "gl-node/22.17.0",
            "Client-Metadata":
              "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
          },
        };
      },
    },
    provider: {
      async patchProvider(ctx, provider) {
        if (!isGeminiOAuth(ctx.auth?.metadata)) return undefined;
        const models = Object.fromEntries(
          Object.entries(provider.models).map(([modelID, model]) => [
            modelID,
            {
              ...model,
              cost: {
                input: 0,
                output: 0,
                cache: {
                  read: 0,
                  write: 0,
                },
              },
            },
          ]),
        );

        return {
          ...provider,
          models,
        };
      },
    },
    chat: {
      async headers(ctx, headers) {
        if (ctx.providerID !== "google") return undefined;
        return {
          strategy: "merge",
          value: {
            ...headers,
            "x-activity-request-id": ctx.requestID,
          },
        };
      },
    },
  },
};
