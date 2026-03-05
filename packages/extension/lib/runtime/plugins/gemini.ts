import { browser } from "@wxt-dev/browser";
import { setAuth } from "@/lib/runtime/auth-store";
import {
  createGeminiCodeAssistFetch,
  GEMINI_CODE_ASSIST_HEADERS,
} from "@/lib/runtime/plugins/gemini-code-assist-transport";
import { waitForOAuthCallback } from "@/lib/runtime/plugins/oauth-browser-callback-util";
import { generatePKCE, generateState } from "@/lib/runtime/plugins/oauth-util";
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

const GEMINI_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const FREE_TIER_ID = "free-tier";
const LEGACY_TIER_ID = "legacy-tier";
const ONBOARD_MAX_ATTEMPTS = 10;
const ONBOARD_POLL_DELAY_MS = 3_000;
const GEMINI_PROJECT_REQUIRED_MESSAGE =
  "Google Gemini requires a Google Cloud project. Enable the Gemini for Google Cloud API on a project you control, then reconnect and set projectId in the Google OAuth form if needed.";

const GEMINI_PROJECT_ID_METADATA_KEY = "geminiProjectId";
const GEMINI_PROJECT_ERROR_METADATA_KEY = "geminiProjectError";

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

type LoadCodeAssistPayload = {
  cloudaicompanionProject?: string | { id?: string };
  currentTier?: {
    id?: string;
    name?: string;
  };
  allowedTiers?: Array<{
    id?: string;
    isDefault?: boolean;
    userDefinedCloudaicompanionProject?: boolean;
  }>;
  ineligibleTiers?: Array<{
    reasonMessage?: string;
  }>;
};

type OnboardUserPayload = {
  name?: string;
  done?: boolean;
  response?: {
    cloudaicompanionProject?: {
      id?: string;
    };
  };
};

export type GeminiProjectContextResult = {
  projectId: string;
  managedProjectId?: string;
};

type GeminiProjectContextDeps = {
  loadCodeAssist: (
    accessToken: string,
    projectId?: string,
  ) => Promise<LoadCodeAssistPayload | null>;
  onboardCodeAssist: (
    accessToken: string,
    tierId: string,
    projectId?: string,
  ) => Promise<string | undefined>;
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

function readMetadataValue(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeProjectId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    return readMetadataValue(value);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  ) {
    return readMetadataValue((value as { id?: string }).id);
  }
  return undefined;
}

function buildCodeAssistMetadata(
  projectId?: string,
  includeDuetProject = true,
) {
  return {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
    ...(projectId && includeDuetProject ? { duetProject: projectId } : {}),
  };
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pickAllowedTier(
  tiers?: LoadCodeAssistPayload["allowedTiers"],
): NonNullable<LoadCodeAssistPayload["allowedTiers"]>[number] {
  if (Array.isArray(tiers) && tiers.length > 0) {
    const preferred = tiers.find((tier) => tier?.isDefault);
    return preferred ?? tiers[0] ?? { id: LEGACY_TIER_ID };
  }

  return {
    id: LEGACY_TIER_ID,
    userDefinedCloudaicompanionProject: true,
  };
}

function buildIneligibleTierMessage(
  tiers?: LoadCodeAssistPayload["ineligibleTiers"],
) {
  if (!Array.isArray(tiers) || tiers.length === 0) return undefined;

  const reasons = tiers
    .map((tier) => readMetadataValue(tier?.reasonMessage))
    .filter((value): value is string => Boolean(value));

  if (reasons.length === 0) return undefined;
  return reasons.join(", ");
}

function buildProjectResolutionError(
  tiers?: LoadCodeAssistPayload["ineligibleTiers"],
) {
  const reason = buildIneligibleTierMessage(tiers);
  return reason
    ? `${GEMINI_PROJECT_REQUIRED_MESSAGE} ${reason}`
    : GEMINI_PROJECT_REQUIRED_MESSAGE;
}

function isRecordEqual(
  left?: Record<string, string>,
  right?: Record<string, string>,
) {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  if (leftEntries.length !== rightEntries.length) return false;
  for (let index = 0; index < leftEntries.length; index += 1) {
    const [leftKey, leftValue] = leftEntries[index] ?? [];
    const [rightKey, rightValue] = rightEntries[index] ?? [];
    if (leftKey !== rightKey) return false;
    if (leftValue !== rightValue) return false;
  }

  return true;
}

function buildPersistedMetadata(input: {
  previous?: Record<string, string>;
  email?: string;
  projectId?: string;
  managedProjectId?: string;
}) {
  const metadata: Record<string, string> = {
    ...(input.previous ?? {}),
    authMode: "gemini_oauth",
  };

  if (input.email) {
    metadata.email = input.email;
  } else {
    delete metadata.email;
  }

  if (input.projectId) {
    metadata.projectId = input.projectId;
  } else {
    delete metadata.projectId;
  }

  if (input.managedProjectId) {
    metadata.managedProjectId = input.managedProjectId;
  } else {
    delete metadata.managedProjectId;
  }

  return metadata;
}

async function waitForGeminiOAuthCallback(signal?: AbortSignal) {
  return await waitForOAuthCallback({
    signal,
    urlPattern: GEMINI_REDIRECT_URL_PATTERN,
    matchesUrl: (url) => url.startsWith(GEMINI_REDIRECT_URI),
    timeoutMs: GEMINI_CALLBACK_TIMEOUT_MS,
    unsupportedErrorMessage:
      "Gemini OAuth callback interception is unavailable: webRequest is not supported in this browser.",
    timeoutErrorMessage:
      "Timed out waiting for Gemini OAuth callback on http://localhost:8085/oauth2callback.",
    registerListenerErrorPrefix:
      "Failed to register Gemini OAuth callback listener",
    onListenerArmed: () => {
      console.info("[builtin-gemini-auth] oauth callback listener armed", {
        pattern: GEMINI_REDIRECT_URL_PATTERN,
      });
    },
    onIntercepted: (url) => {
      console.info("[builtin-gemini-auth] oauth callback intercepted", {
        hasQuery: url.includes("?"),
      });
    },
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

async function loadCodeAssist(
  accessToken: string,
  projectId?: string,
): Promise<LoadCodeAssistPayload | null> {
  const metadata = buildCodeAssistMetadata(projectId);
  const body: Record<string, unknown> = { metadata };

  if (projectId) {
    body.cloudaicompanionProject = projectId;
  }

  try {
    const response = await fetch(
      `${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...GEMINI_CODE_ASSIST_HEADERS,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as LoadCodeAssistPayload;
  } catch {
    return null;
  }
}

async function onboardCodeAssist(
  accessToken: string,
  tierId: string,
  projectId?: string,
): Promise<string | undefined> {
  const isFreeTier = tierId === FREE_TIER_ID;
  const metadata = buildCodeAssistMetadata(projectId, !isFreeTier);

  const body: Record<string, unknown> = {
    tierId,
    metadata,
  };

  if (!isFreeTier) {
    if (!projectId) {
      throw new Error(GEMINI_PROJECT_REQUIRED_MESSAGE);
    }
    body.cloudaicompanionProject = projectId;
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    ...GEMINI_CODE_ASSIST_HEADERS,
  };

  const base = `${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal`;
  try {
    const response = await fetch(`${base}:onboardUser`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return undefined;
    }

    let payload = (await response.json()) as OnboardUserPayload;

    if (!payload.done && payload.name) {
      for (let attempt = 0; attempt < ONBOARD_MAX_ATTEMPTS; attempt += 1) {
        await wait(ONBOARD_POLL_DELAY_MS);
        const opResponse = await fetch(`${base}/${payload.name}`, {
          method: "GET",
          headers,
        });

        if (!opResponse.ok) {
          return undefined;
        }

        payload = (await opResponse.json()) as OnboardUserPayload;
        if (payload.done) {
          break;
        }
      }
    }

    const managedProjectId = normalizeProjectId(
      payload.response?.cloudaicompanionProject,
    );

    if (payload.done && managedProjectId) {
      return managedProjectId;
    }

    if (payload.done && projectId) {
      return projectId;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function resolveGeminiProjectContext(
  accessToken: string,
  metadata?: Record<string, string>,
  deps: GeminiProjectContextDeps = {
    loadCodeAssist,
    onboardCodeAssist,
  },
): Promise<GeminiProjectContextResult> {
  const configuredProjectId = readMetadataValue(metadata?.projectId);
  const managedProjectId = readMetadataValue(metadata?.managedProjectId);

  if (configuredProjectId) {
    return {
      projectId: configuredProjectId,
      managedProjectId,
    };
  }

  if (managedProjectId) {
    return {
      projectId: managedProjectId,
      managedProjectId,
    };
  }

  const loaded = await deps.loadCodeAssist(accessToken, configuredProjectId);
  if (!loaded) {
    throw new Error(GEMINI_PROJECT_REQUIRED_MESSAGE);
  }

  const discoveredProjectId = normalizeProjectId(
    loaded.cloudaicompanionProject,
  );
  if (discoveredProjectId) {
    return {
      projectId: discoveredProjectId,
      managedProjectId: discoveredProjectId,
    };
  }

  const currentTierId = readMetadataValue(loaded.currentTier?.id);
  if (currentTierId) {
    throw new Error(buildProjectResolutionError(loaded.ineligibleTiers));
  }

  const tier = pickAllowedTier(loaded.allowedTiers);
  const tierId = readMetadataValue(tier.id) ?? LEGACY_TIER_ID;

  if (tierId !== FREE_TIER_ID && !configuredProjectId) {
    throw new Error(buildProjectResolutionError(loaded.ineligibleTiers));
  }

  const onboardedProjectId = await deps.onboardCodeAssist(
    accessToken,
    tierId,
    configuredProjectId,
  );

  if (onboardedProjectId) {
    return {
      projectId: onboardedProjectId,
      managedProjectId: onboardedProjectId,
    };
  }

  if (configuredProjectId) {
    return {
      projectId: configuredProjectId,
      managedProjectId: configuredProjectId,
    };
  }

  throw new Error(buildProjectResolutionError(loaded.ineligibleTiers));
}

function isGeminiOAuth(metadata?: Record<string, string>) {
  return metadata?.authMode === "gemini_oauth";
}

function isGeminiAdapterTarget(input: {
  providerID: string;
  modelNpm: string;
  metadata?: Record<string, string>;
}) {
  return (
    input.providerID === "google" &&
    input.modelNpm === "@ai-sdk/google" &&
    isGeminiOAuth(input.metadata)
  );
}

function readGeminiTransportMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  if (!metadata) return undefined;
  return readMetadataValue(metadata[key]);
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
                console.error("[builtin-gemini-auth] token exchange failed", {
                  error: toErrorMessage(error),
                });
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
                metadata: buildPersistedMetadata({
                  email,
                  projectId,
                  previous: {
                    authMode: "gemini_oauth",
                  },
                }),
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
        }

        if (!access) {
          const errorMessage =
            "Gemini OAuth access token is unavailable. Reconnect Google OAuth and retry.";
          return {
            transport: {
              authType: "bearer",
              headers: {
                ...GEMINI_CODE_ASSIST_HEADERS,
              },
              metadata: {
                [GEMINI_PROJECT_ERROR_METADATA_KEY]: errorMessage,
              },
            },
          };
        }

        const metadata = auth.metadata ?? {};
        const projectId = readMetadataValue(metadata.projectId);
        const email = readMetadataValue(metadata.email);
        let managedProjectId = readMetadataValue(metadata.managedProjectId);
        let effectiveProjectId = projectId ?? managedProjectId;
        let projectResolutionError: string | undefined;

        if (!effectiveProjectId) {
          try {
            const resolved = await resolveGeminiProjectContext(
              access,
              metadata,
            );
            effectiveProjectId = resolved.projectId;
            managedProjectId =
              resolved.managedProjectId ??
              managedProjectId ??
              effectiveProjectId;
          } catch (error) {
            projectResolutionError = toErrorMessage(error);
            console.warn("[builtin-gemini-auth] project resolution failed", {
              error: projectResolutionError,
            });
          }
        }

        const nextMetadata = buildPersistedMetadata({
          previous: auth.metadata,
          email,
          projectId,
          managedProjectId,
        });

        const shouldPersistAuth =
          access !== auth.access ||
          refresh !== auth.refresh ||
          expiresAt !== auth.expiresAt ||
          !isRecordEqual(auth.metadata, nextMetadata);

        if (shouldPersistAuth) {
          await setAuth(ctx.providerID, {
            type: "oauth",
            access,
            refresh,
            expiresAt,
            metadata: nextMetadata,
          });
        }

        return {
          transport: {
            apiKey: access,
            authType: "bearer",
            headers: {
              ...GEMINI_CODE_ASSIST_HEADERS,
            },
            metadata: {
              ...(effectiveProjectId
                ? {
                    [GEMINI_PROJECT_ID_METADATA_KEY]: effectiveProjectId,
                  }
                : {}),
              ...(projectResolutionError
                ? {
                    [GEMINI_PROJECT_ERROR_METADATA_KEY]: projectResolutionError,
                  }
                : {}),
            },
          },
        };
      },
    },
    adapter: {
      async patchTransport(ctx, transport) {
        if (
          !isGeminiAdapterTarget({
            providerID: ctx.providerID,
            modelNpm: ctx.model.api.npm,
            metadata: ctx.auth?.metadata,
          })
        ) {
          return undefined;
        }

        const projectId = readGeminiTransportMetadata(
          transport.metadata,
          GEMINI_PROJECT_ID_METADATA_KEY,
        );
        if (!projectId) {
          return undefined;
        }

        return {
          fetch: createGeminiCodeAssistFetch({
            projectId,
          }),
        };
      },
      async patchFactoryOptions(ctx) {
        if (
          !isGeminiAdapterTarget({
            providerID: ctx.providerID,
            modelNpm: ctx.model.api.npm,
            metadata: ctx.auth?.metadata,
          })
        ) {
          return undefined;
        }

        return {
          apiKey: "gemini-oauth-placeholder",
        };
      },
      async cacheKeyParts(ctx, currentParts, state) {
        if (
          !isGeminiAdapterTarget({
            providerID: ctx.providerID,
            modelNpm: ctx.model.api.npm,
            metadata: ctx.auth?.metadata,
          })
        ) {
          return undefined;
        }

        void currentParts;

        const projectId = readGeminiTransportMetadata(
          state.transport.metadata,
          GEMINI_PROJECT_ID_METADATA_KEY,
        );
        return {
          geminiCodeAssist: {
            mode: "oauth",
            projectId: projectId ?? "unknown",
          },
        };
      },
      async validate(ctx, state) {
        if (
          !isGeminiAdapterTarget({
            providerID: ctx.providerID,
            modelNpm: ctx.model.api.npm,
            metadata: ctx.auth?.metadata,
          })
        ) {
          return;
        }

        const projectError = readGeminiTransportMetadata(
          state.transport.metadata,
          GEMINI_PROJECT_ERROR_METADATA_KEY,
        );
        if (projectError) {
          throw new Error(projectError);
        }

        if (state.transport.authType !== "bearer" || !state.transport.apiKey) {
          throw new Error(
            "Gemini OAuth authentication is unavailable. Reconnect Google OAuth and retry.",
          );
        }

        const projectId = readGeminiTransportMetadata(
          state.transport.metadata,
          GEMINI_PROJECT_ID_METADATA_KEY,
        );
        if (!projectId) {
          throw new Error(
            "Gemini OAuth project is not configured. Enable the Gemini for Google Cloud API and set projectId in Google OAuth settings if auto-onboarding cannot resolve one.",
          );
        }
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
