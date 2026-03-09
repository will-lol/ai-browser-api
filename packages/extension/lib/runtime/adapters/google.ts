import { browser } from "@wxt-dev/browser";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import {
  optionalMetadataString,
  parseOptionalMetadataObject,
} from "./auth-metadata";
import { createGeminiCodeAssistFetch, GEMINI_CODE_ASSIST_HEADERS } from "./gemini-code-assist-transport";
import { createApiKeyMethod } from "./generic-factory";
import { wrapLanguageModel } from "./helpers";
import {
  optionalTrimmedStringSchema,
  parseProviderOptions,
} from "./provider-options";
import { defineAuthSchema } from "./schema";
import { mergeModelHeaders } from "./factory-language-model";
import type {
  AIAdapter,
  AdapterAuthContext,
  AdapterAuthorizeContext,
  LoadedAdapterState,
  ParsedAuthRecord,
} from "./types";
import {
  setAuth,
  type AuthRecord,
  type AuthResult,
} from "@/lib/runtime/auth-store";
import { waitForOAuthCallback } from "@/lib/runtime/oauth-browser-callback-util";
import { generatePKCE, generateState } from "@/lib/runtime/oauth-util";
import type { ProviderInfo } from "@/lib/runtime/provider-registry";

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

type GeminiProjectContextResult = {
  projectId: string;
  managedProjectId?: string;
};

type GoogleAuthMetadata = {
  email?: string;
  projectId?: string;
  managedProjectId?: string;
};

const googleProviderOptionsSchema = z.object({
  baseURL: optionalTrimmedStringSchema,
  name: optionalTrimmedStringSchema,
});

type GoogleProviderOptions = z.output<typeof googleProviderOptionsSchema>;

const googleAuthMetadataSchema = z.object({
  email: optionalMetadataString,
  projectId: optionalMetadataString,
  managedProjectId: optionalMetadataString,
});

const googleTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});

const googleUserInfoSchema = z.object({
  email: optionalMetadataString,
});

const loadCodeAssistPayloadSchema = z.object({
  cloudaicompanionProject: z
    .union([
      z.object({
        id: optionalMetadataString,
      }),
      optionalMetadataString,
    ])
    .catch(undefined)
    .optional(),
  currentTier: z
    .object({
      id: optionalMetadataString,
      name: optionalMetadataString,
    })
    .catch({})
    .optional(),
  allowedTiers: z
    .array(
      z.object({
        id: optionalMetadataString,
        isDefault: z.boolean().optional(),
        userDefinedCloudaicompanionProject: z.boolean().optional(),
      }),
    )
    .optional(),
  ineligibleTiers: z
    .array(
      z.object({
        reasonMessage: optionalMetadataString,
      }),
    )
    .optional(),
});

const onboardUserPayloadSchema = z.object({
  name: optionalMetadataString,
  done: z.boolean().optional(),
  response: z
    .object({
      cloudaicompanionProject: z
        .object({
          id: optionalMetadataString,
        })
        .optional(),
    })
    .optional(),
});

type GoogleRuntimeState =
  | {
      kind: "api";
    }
  | {
      kind: "oauth";
      projectId?: string;
      projectResolutionError?: string;
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

function buildGoogleSettings(input: {
  providerID: string;
  providerOptions: GoogleProviderOptions;
  headers?: Record<string, string>;
  transport: {
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    fetch?: typeof fetch;
  };
  state: GoogleRuntimeState;
}): Parameters<typeof createGoogleGenerativeAI>[0] {
  return {
    baseURL:
      readMetadataValue(input.transport.baseURL) ??
      input.providerOptions.baseURL,
    apiKey:
      readMetadataValue(input.transport.apiKey) ??
      (input.state.kind === "oauth" ? "gemini-oauth-placeholder" : undefined),
    headers: {
      ...(input.headers ?? {}),
      ...(input.transport.headers ?? {}),
    },
    fetch: input.transport.fetch,
    name: input.providerOptions.name ?? input.providerID,
  };
}

const projectIdInputSchema = z
  .union([
    z.string(),
    z.object({
      id: z.string().optional(),
    }),
  ])
  .transform((value) =>
    typeof value === "string"
      ? readMetadataValue(value)
      : readMetadataValue(value.id),
  )
  .catch(undefined);

function normalizeProjectId(value: unknown): string | undefined {
  const result = projectIdInputSchema.safeParse(value);
  return result.success ? result.data : undefined;
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
  left?: GoogleAuthMetadata,
  right?: GoogleAuthMetadata,
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
  previous?: GoogleAuthMetadata;
  email?: string;
  projectId?: string;
  managedProjectId?: string;
}) {
  return parseOptionalMetadataObject(googleAuthMetadataSchema, {
    ...(input.previous ?? {}),
    email: input.email,
    projectId: input.projectId,
    managedProjectId: input.managedProjectId,
  });
}

function parseGoogleStoredAuth(
  auth?: AuthRecord,
): ParsedAuthRecord<GoogleAuthMetadata> | undefined {
  if (!auth) return undefined;
  if (auth.type === "api") {
    return {
      ...auth,
      metadata: undefined,
    };
  }

  const metadata = parseOptionalMetadataObject(
    googleAuthMetadataSchema,
    auth.metadata,
  );

  return {
    ...auth,
    metadata,
  };
}

function serializeGoogleAuth(input: {
  result: AuthResult<GoogleAuthMetadata>;
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

  return {
    ...input.result,
    metadata: parseOptionalMetadataObject(
      googleAuthMetadataSchema,
      input.result.metadata,
    ),
  };
}

async function waitForGeminiOAuthCallback(signal?: AbortSignal) {
  return waitForOAuthCallback({
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

  const payload = await response.json().catch(() => undefined);
  const result = googleTokenResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new Error("Gemini OAuth exchange returned an invalid response.");
  }

  return result.data;
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

  const payload = await response.json().catch(() => undefined);
  const result = googleTokenResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new Error("Gemini token refresh returned an invalid response.");
  }

  return result.data;
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
  const payload = await response.json().catch(() => undefined);
  const result = googleUserInfoSchema.safeParse(payload);
  return result.success ? result.data.email : undefined;
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

    const payload = await response.json().catch(() => undefined);
    const result = loadCodeAssistPayloadSchema.safeParse(payload);
    return result.success ? result.data : null;
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

    let parsed = onboardUserPayloadSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return undefined;
    }
    let payload = parsed.data;
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

        parsed = onboardUserPayloadSchema.safeParse(
          await opResponse.json().catch(() => undefined),
        );
        if (!parsed.success) {
          return undefined;
        }
        payload = parsed.data;
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

function isGeminiOAuth(
  auth?: ParsedAuthRecord<GoogleAuthMetadata>,
): auth is Extract<ParsedAuthRecord<GoogleAuthMetadata>, { type: "oauth" }> {
  return auth?.type === "oauth" && auth.methodType === "oauth";
}

async function authorizeGeminiOAuth(input: AdapterAuthorizeContext<{ projectId?: string }>) {
  const clientSecret = getGeminiClientSecret();
  const redirectUri = GEMINI_REDIRECT_URI;
  const pkce = await generatePKCE();
  const state = generateState();

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
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

  let authTabId: number | undefined;
  try {
    const tab = await browser.tabs.create({
      url: url.toString(),
      active: true,
    });
    authTabId = tab.id;
  } catch (error) {
    throw new Error(`Failed to open Google OAuth tab: ${toErrorMessage(error)}`, {
      cause: error,
    });
  }

  let callbackUrl: string;
  try {
    callbackUrl = await waitForGeminiOAuthCallback(input.signal);
  } finally {
    if (typeof authTabId === "number") {
      await browser.tabs.remove(authTabId).catch(() => {
        // Ignore tab close failures if user already closed it.
      });
    }
  }

  const parsed = input.oauth.parseCallback(callbackUrl);
  if (parsed.error) {
    throw new Error(`Google OAuth failed: ${parsed.errorDescription ?? parsed.error}`);
  }
  if (!parsed.code) throw new Error("Missing Google authorization code");
  if (parsed.state && parsed.state !== state) {
    throw new Error("OAuth state mismatch");
  }

  const tokens = await exchangeAuthorizationCode(
    parsed.code,
    pkce.verifier,
    redirectUri,
    clientSecret,
  );
  if (!tokens.refresh_token) {
    throw new Error("Missing refresh token in Google OAuth response");
  }

  const projectId = input.values.projectId?.trim() || undefined;
  const email = await resolveUserEmail(tokens.access_token);
  return {
    type: "oauth" as const,
    methodID: "oauth" as const,
    methodType: "oauth" as const,
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    metadata: buildPersistedMetadata({
      email,
      projectId,
    }),
  };
}

export async function loadGeminiOAuthState(
  ctx: AdapterAuthContext<GoogleAuthMetadata>,
): Promise<LoadedAdapterState<GoogleRuntimeState>> {
  if (!ctx.auth || ctx.auth.type !== "oauth" || !isGeminiOAuth(ctx.auth)) {
    return {
      transport: {},
      state: {
        kind: "api",
      },
    };
  }

  let access = ctx.auth.access;
  let refresh = ctx.auth.refresh;
  let expiresAt = ctx.auth.expiresAt;

  if (refresh && (!expiresAt || expiresAt <= Date.now() + 60_000)) {
    const refreshed = await refreshAccessToken(refresh, getGeminiClientSecret());
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
      },
      state: {
        kind: "oauth",
        projectResolutionError: errorMessage,
      },
    };
  }

  const metadata = ctx.auth.metadata ?? {};
  const projectId = readMetadataValue(metadata.projectId);
  const email = readMetadataValue(metadata.email);
  let managedProjectId = readMetadataValue(metadata.managedProjectId);
  let effectiveProjectId = projectId ?? managedProjectId;
  let projectResolutionError: string | undefined;

  if (!effectiveProjectId) {
    try {
      const resolved = await resolveGeminiProjectContext(access, metadata);
      effectiveProjectId = resolved.projectId;
      managedProjectId =
        resolved.managedProjectId ?? managedProjectId ?? effectiveProjectId;
    } catch (error) {
      projectResolutionError = toErrorMessage(error);
      console.warn("[adapter:google] project resolution failed", {
        error: projectResolutionError,
      });
    }
  }

  const nextMetadata = buildPersistedMetadata({
    previous: ctx.auth.metadata,
    email,
    projectId,
    managedProjectId,
  });

  const shouldPersistAuth =
    access !== ctx.auth.access ||
    refresh !== ctx.auth.refresh ||
    expiresAt !== ctx.auth.expiresAt ||
    !isRecordEqual(ctx.auth.metadata, nextMetadata);

  if (shouldPersistAuth) {
    await setAuth(ctx.providerID, {
      type: "oauth",
      access,
      refresh,
      expiresAt,
      methodID: ctx.auth.methodID,
      methodType: ctx.auth.methodType,
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
      ...(effectiveProjectId
        ? {
            fetch: createGeminiCodeAssistFetch({
              projectId: effectiveProjectId,
            }),
          }
        : {}),
    },
    state: {
      kind: "oauth",
      projectId: effectiveProjectId,
      projectResolutionError,
    },
  };
}

export const googleAdapter: AIAdapter<
  GoogleAuthMetadata,
  GoogleRuntimeState,
  GoogleProviderOptions
> = {
  key: "provider:google",
  displayName: "Google",
  match: {
    providerIDs: ["google"],
  },
  parseProviderOptions: (provider) =>
    parseProviderOptions(googleProviderOptionsSchema, provider.options),
  auth: {
    parseStoredAuth: parseGoogleStoredAuth,
    serializeAuth: serializeGoogleAuth,
    async methods(ctx) {
      return [
        createApiKeyMethod(ctx),
        {
          id: "oauth",
          type: "oauth",
          label: "OAuth with Google (Gemini CLI)",
          inputSchema: defineAuthSchema({
            projectId: {
              schema: z.string().trim().optional(),
              ui: {
                type: "text",
                label: "Google Cloud project ID (optional)",
                placeholder: "my-gcp-project",
                required: false,
              },
            },
          }),
          authorize: authorizeGeminiOAuth,
        },
      ];
    },
    async load(ctx) {
      if (!ctx.auth) {
        return {
          transport: {},
          state: {
            kind: "api",
          },
        };
      }

      if (ctx.auth.type === "api") {
        return {
          transport: {
            apiKey: ctx.auth.key,
          },
          state: {
            kind: "api",
          },
        };
      }
      return loadGeminiOAuthState(ctx);
    },
  },
  async patchCatalog(ctx, provider) {
    if (!isGeminiOAuth(ctx.auth)) return provider;
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
    } satisfies ProviderInfo;
  },
  async createModel({ context, providerOptions, transport, state }) {
    if (state.kind === "oauth" && state.projectResolutionError) {
      throw new Error(state.projectResolutionError);
    }

    const provider = createGoogleGenerativeAI(
      buildGoogleSettings({
        providerID: context.providerID,
        providerOptions,
        headers: context.model.headers,
        transport,
        state,
      }),
    );
    const baseModel = provider.languageModel(context.model.api.id);

    if (state.kind !== "oauth") {
      return baseModel;
    }

    return wrapLanguageModel(baseModel, async (options) =>
      mergeModelHeaders(options, {
        "x-activity-request-id": context.requestID,
      }),
    );
  },
};
