import { browser } from "@wxt-dev/browser";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  RuntimeAuthProviderError,
  type RuntimeRpcError,
  RuntimeUpstreamServiceError,
  RuntimeValidationError,
  isRuntimeRpcError,
} from "@llm-bridge/contracts";
import { parseOptionalMetadataObject } from "./auth-metadata";
import {
  createGeminiCodeAssistFetch,
  GEMINI_CODE_ASSIST_HEADERS,
} from "./gemini-code-assist-transport";
import { createApiKeyMethod } from "./generic-factory";
import { wrapLanguageModel } from "./helpers";
import { parseProviderOptions } from "./provider-options";
import { defineAuthSchema } from "./schema";
import { mergeModelHeaders } from "./factory-language-model";
import type {
  AIAdapter,
  AnyAuthMethodDefinition,
  AdapterAuthorizeContext,
  RuntimeAdapterContext,
} from "./types";
import type { AuthRecord } from "@/background/runtime/auth/auth-store";
import { waitForOAuthCallback } from "@/background/runtime/auth/oauth-browser-callback-util";
import { generatePKCE, generateState } from "@/background/runtime/auth/oauth-util";
import type { ProviderInfo } from "@/background/runtime/catalog/provider-registry";
import { decodeSchemaOrUndefined } from "@/background/runtime/core/effect-schema";

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
const GOOGLE_PROVIDER_ID = "google";

type LoadCodeAssistPayload = {
  cloudaicompanionProject?: unknown;
  currentTier?: {
    id?: string;
    name?: string;
  };
  allowedTiers?: ReadonlyArray<{
    id?: string;
    isDefault?: boolean;
    userDefinedCloudaicompanionProject?: boolean;
  }>;
  ineligibleTiers?: ReadonlyArray<{
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

const googleProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

type GoogleProviderOptions = Schema.Schema.Type<
  typeof googleProviderOptionsSchema
>;

const googleAuthMetadataSchema = Schema.Struct({
  email: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  managedProjectId: Schema.optional(Schema.String),
});

const googleTokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.optional(Schema.String),
});

const googleUserInfoSchema = Schema.Struct({
  email: Schema.optional(Schema.String),
});

const loadCodeAssistPayloadSchema = Schema.Struct({
  cloudaicompanionProject: Schema.optional(Schema.Unknown),
  currentTier: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
    }),
  ),
  allowedTiers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        isDefault: Schema.optional(Schema.Boolean),
        userDefinedCloudaicompanionProject: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  ineligibleTiers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        reasonMessage: Schema.optional(Schema.String),
      }),
    ),
  ),
});

const onboardUserPayloadSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  done: Schema.optional(Schema.Boolean),
  response: Schema.optional(
    Schema.Struct({
      cloudaicompanionProject: Schema.optional(
        Schema.Struct({
          id: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
});

type GoogleExecutionState = {
  kind: "api" | "oauth";
  apiKey?: string;
  baseURL?: string;
  headers: Record<string, string>;
  fetch?: typeof fetch;
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

function googleAuthProviderError(input: {
  operation: string;
  message: string;
  retryable?: boolean;
}) {
  return new RuntimeAuthProviderError({
    providerID: GOOGLE_PROVIDER_ID,
    operation: input.operation,
    retryable: input.retryable ?? false,
    message: input.message,
  });
}

function googleUpstreamError(input: {
  operation: string;
  statusCode: number;
  detail?: string;
}) {
  return new RuntimeUpstreamServiceError({
    providerID: GOOGLE_PROVIDER_ID,
    operation: input.operation,
    statusCode: input.statusCode,
    retryable:
      input.statusCode >= 500 ||
      input.statusCode === 429 ||
      input.statusCode === 408,
    message: input.detail
      ? `Google authentication request failed: ${input.detail.slice(0, 300)}`
      : "Google authentication request failed.",
  });
}

function toGoogleError(operation: string, error: unknown) {
  if (isRuntimeRpcError(error)) {
    return error;
  }

  return googleAuthProviderError({
    operation,
    message: error instanceof Error ? error.message : String(error),
  });
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
  execution: GoogleExecutionState;
}): Parameters<typeof createGoogleGenerativeAI>[0] {
  return {
    baseURL:
      readMetadataValue(input.execution.baseURL) ??
      input.providerOptions.baseURL,
    apiKey:
      readMetadataValue(input.execution.apiKey) ??
      (input.execution.kind === "oauth"
        ? "gemini-oauth-placeholder"
        : undefined),
    headers: {
      ...(input.headers ?? {}),
      ...input.execution.headers,
    },
    fetch: input.execution.fetch,
    name: input.providerOptions.name ?? input.providerID,
  };
}

function normalizeProjectId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return readMetadataValue(value);
  }

  if (value && typeof value === "object" && "id" in value) {
    return readMetadataValue((value as { id?: unknown }).id);
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

function isRecordEqual(left?: GoogleAuthMetadata, right?: GoogleAuthMetadata) {
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

function normalizeGoogleAuth(
  auth?: AuthRecord,
): AuthRecord<GoogleAuthMetadata> | undefined {
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

function waitForGeminiOAuthCallback(signal?: AbortSignal) {
  return Effect.tryPromise({
    try: () =>
      waitForOAuthCallback({
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
      }),
    catch: (error) => toGoogleError("oauth.waitForCallback", error),
  });
}

function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri: string,
  clientSecret: string,
) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("https://oauth2.googleapis.com/token", {
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
        }),
      catch: (error) => toGoogleError("oauth.exchangeAuthorizationCode", error),
    });

    if (!response.ok) {
      const detail = yield* Effect.tryPromise({
        try: () => response.text().catch(() => ""),
        catch: (error) =>
          toGoogleError("oauth.exchangeAuthorizationCode.detail", error),
      }).pipe(Effect.catchAll(() => Effect.succeed("")));
      return yield* Effect.fail(
        googleUpstreamError({
          operation: "oauth.exchangeAuthorizationCode",
          statusCode: response.status,
          detail,
        }),
      );
    }

    const payload = yield* Effect.tryPromise({
      try: () => response.json().catch(() => undefined),
      catch: (error) => toGoogleError("oauth.exchangeAuthorizationCode", error),
    });
    const result = decodeSchemaOrUndefined(googleTokenResponseSchema, payload);
    if (!result) {
      return yield* Effect.fail(
        googleAuthProviderError({
          operation: "oauth.exchangeAuthorizationCode.parse",
          message: "Gemini OAuth exchange returned an invalid response.",
        }),
      );
    }

    return result;
  });
}

function refreshAccessToken(refreshToken: string, clientSecret: string) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("https://oauth2.googleapis.com/token", {
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
        }),
      catch: (error) => toGoogleError("oauth.refreshAccessToken", error),
    });

    if (!response.ok) {
      const detail = yield* Effect.tryPromise({
        try: () => response.text().catch(() => ""),
        catch: (error) => toGoogleError("oauth.refreshAccessToken.detail", error),
      }).pipe(Effect.catchAll(() => Effect.succeed("")));
      return yield* Effect.fail(
        googleUpstreamError({
          operation: "oauth.refreshAccessToken",
          statusCode: response.status,
          detail,
        }),
      );
    }

    const payload = yield* Effect.tryPromise({
      try: () => response.json().catch(() => undefined),
      catch: (error) => toGoogleError("oauth.refreshAccessToken", error),
    });
    const result = decodeSchemaOrUndefined(googleTokenResponseSchema, payload);
    if (!result) {
      return yield* Effect.fail(
        googleAuthProviderError({
          operation: "oauth.refreshAccessToken.parse",
          message: "Gemini token refresh returned an invalid response.",
        }),
      );
    }

    return result;
  });
}

function resolveUserEmail(accessToken: string) {
  return Effect.tryPromise({
    try: async () => {
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
      return decodeSchemaOrUndefined(googleUserInfoSchema, payload)?.email;
    },
    catch: (error) => toGoogleError("oauth.resolveUserEmail", error),
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
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
    return (
      decodeSchemaOrUndefined(loadCodeAssistPayloadSchema, payload) ?? null
    );
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

    let payload = decodeSchemaOrUndefined(
      onboardUserPayloadSchema,
      await response.json().catch(() => undefined),
    );
    if (!payload) {
      return undefined;
    }
    if (!payload.done && payload.name) {
      for (let attempt = 0; attempt < ONBOARD_MAX_ATTEMPTS; attempt += 1) {
        await wait(ONBOARD_POLL_DELAY_MS);
        const opResponse: Response = await fetch(`${base}/${payload.name}`, {
          method: "GET",
          headers,
        });

        if (!opResponse.ok) {
          return undefined;
        }

        payload = decodeSchemaOrUndefined(
          onboardUserPayloadSchema,
          await opResponse.json().catch(() => undefined),
        );
        if (!payload) {
          return undefined;
        }
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

export function resolveGeminiProjectContext(
  accessToken: string,
  metadata?: Record<string, string>,
  deps: GeminiProjectContextDeps = {
    loadCodeAssist,
    onboardCodeAssist,
  },
): Effect.Effect<GeminiProjectContextResult, RuntimeRpcError> {
  return Effect.gen(function* () {
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

    const loaded = yield* Effect.tryPromise({
      try: () => deps.loadCodeAssist(accessToken, configuredProjectId),
      catch: (error) => toGoogleError("codeAssist.load", error),
    });
    if (!loaded) {
      return yield* Effect.fail(
        new RuntimeValidationError({
          message: GEMINI_PROJECT_REQUIRED_MESSAGE,
        }),
      );
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
      return yield* Effect.fail(
        new RuntimeValidationError({
          message: buildProjectResolutionError(loaded.ineligibleTiers),
        }),
      );
    }

    const tier = pickAllowedTier(loaded.allowedTiers);
    const tierId = readMetadataValue(tier.id) ?? LEGACY_TIER_ID;

    if (tierId !== FREE_TIER_ID && !configuredProjectId) {
      return yield* Effect.fail(
        new RuntimeValidationError({
          message: buildProjectResolutionError(loaded.ineligibleTiers),
        }),
      );
    }

    const onboardedProjectId = yield* Effect.tryPromise({
      try: () =>
        deps.onboardCodeAssist(accessToken, tierId, configuredProjectId),
      catch: (error) => toGoogleError("codeAssist.onboard", error),
    });

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

    return yield* Effect.fail(
      new RuntimeValidationError({
        message: buildProjectResolutionError(loaded.ineligibleTiers),
      }),
    );
  });
}

function isGeminiOAuth(
  auth?: AuthRecord<GoogleAuthMetadata>,
): auth is Extract<AuthRecord<GoogleAuthMetadata>, { type: "oauth" }> {
  return auth?.type === "oauth" && auth.methodType === "oauth";
}

function authorizeGeminiOAuth(
  input: AdapterAuthorizeContext<{ projectId?: string }>,
) {
  return Effect.gen(function* () {
    const clientSecret = yield* Effect.try({
      try: () => getGeminiClientSecret(),
      catch: (error) => toGoogleError("oauth.clientSecret", error),
    });
    const redirectUri = GEMINI_REDIRECT_URI;
    const pkce = yield* Effect.tryPromise({
      try: () => generatePKCE(),
      catch: (error) => toGoogleError("oauth.generatePKCE", error),
    });
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

    const tab = yield* Effect.tryPromise({
      try: () =>
        browser.tabs.create({
          url: url.toString(),
          active: true,
        }),
      catch: (error) =>
        googleAuthProviderError({
          operation: "oauth.openTab",
          message: `Failed to open Google OAuth tab: ${toErrorMessage(error)}`,
        }),
    });
    const authTabId = tab.id;

    const callbackUrl = yield* Effect.ensuring(
      waitForGeminiOAuthCallback(input.signal),
      typeof authTabId === "number"
        ? Effect.ignore(
            Effect.tryPromise({
              try: () => browser.tabs.remove(authTabId),
              catch: (error) => error,
            }),
          )
        : Effect.void,
    );

    const parsed = input.oauth.parseCallback(callbackUrl);
    if (parsed.error) {
      return yield* Effect.fail(
        googleAuthProviderError({
          operation: "oauth.authorize",
          message: `Google OAuth failed: ${parsed.errorDescription ?? parsed.error}`,
        }),
      );
    }
    if (!parsed.code) {
      return yield* new RuntimeValidationError({
        message: "Missing Google authorization code",
      });
    }
    if (parsed.state && parsed.state !== state) {
      return yield* new RuntimeValidationError({
        message: "OAuth state mismatch",
      });
    }

    const tokens = yield* exchangeAuthorizationCode(
      parsed.code,
      pkce.verifier,
      redirectUri,
      clientSecret,
    );
    if (!tokens.refresh_token) {
      return yield* Effect.fail(
        googleAuthProviderError({
          operation: "oauth.authorize",
          message: "Missing refresh token in Google OAuth response",
        }),
      );
    }

    const projectId = input.values.projectId?.trim() || undefined;
    const email = yield* resolveUserEmail(tokens.access_token);
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
  });
}

export function resolveGoogleExecutionState(
  context: RuntimeAdapterContext,
){
  return Effect.gen(function* () {
    const auth = normalizeGoogleAuth(context.auth);

    if (!auth) {
      return {
        kind: "api",
        apiKey: undefined,
        baseURL: context.model.api.url,
        headers: {},
      } satisfies GoogleExecutionState;
    }

    if (auth.type === "api" || !isGeminiOAuth(auth)) {
      return {
        kind: "api",
        apiKey: auth.type === "api" ? auth.key : undefined,
        baseURL: context.model.api.url,
        headers: {},
      } satisfies GoogleExecutionState;
    }

    let access = auth.access;
    let refresh = auth.refresh;
    let expiresAt = auth.expiresAt;

    if (refresh && (!expiresAt || expiresAt <= context.runtime.now() + 60_000)) {
      const clientSecret = yield* Effect.try({
        try: () => getGeminiClientSecret(),
        catch: (error) => toGoogleError("oauth.clientSecret", error),
      });
      const refreshed = yield* refreshAccessToken(refresh, clientSecret);
      access = refreshed.access_token;
      refresh = refreshed.refresh_token ?? refresh;
      expiresAt = context.runtime.now() + refreshed.expires_in * 1000;
    }

    if (!access) {
      const errorMessage =
        "Gemini OAuth access token is unavailable. Reconnect Google OAuth and retry.";
      return {
        kind: "oauth",
        apiKey: undefined,
        baseURL: context.model.api.url,
        headers: {
          ...GEMINI_CODE_ASSIST_HEADERS,
        },
        projectResolutionError: errorMessage,
      } satisfies GoogleExecutionState;
    }

    const metadata = auth.metadata ?? {};
    const projectId = readMetadataValue(metadata.projectId);
    const email = readMetadataValue(metadata.email);
    let managedProjectId = readMetadataValue(metadata.managedProjectId);
    let effectiveProjectId = projectId ?? managedProjectId;
    let projectResolutionError: string | undefined;

    if (!effectiveProjectId) {
      const resolution = yield* Effect.exit(
        resolveGeminiProjectContext(access, metadata),
      );
      if (resolution._tag === "Success") {
        effectiveProjectId = resolution.value.projectId;
        managedProjectId =
          resolution.value.managedProjectId ??
          managedProjectId ??
          effectiveProjectId;
      } else {
        const error = Cause.squash(resolution.cause);
        projectResolutionError = toErrorMessage(error);
        console.warn("[adapter:google] project resolution failed", {
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
      yield* context.authStore.set({
        type: "oauth",
        access,
        refresh,
        expiresAt,
        methodID: auth.methodID,
        methodType: auth.methodType,
        metadata: nextMetadata,
      });
    }

    return {
      kind: "oauth",
      apiKey: access,
      baseURL: context.model.api.url,
      headers: {
        Authorization: `Bearer ${access}`,
        ...GEMINI_CODE_ASSIST_HEADERS,
      },
      fetch: effectiveProjectId
        ? createGeminiCodeAssistFetch({
            projectId: effectiveProjectId,
          })
        : undefined,
      projectId: effectiveProjectId,
      projectResolutionError,
    } satisfies GoogleExecutionState;
  });
}

const optionalAuthStringSchema = Schema.Union(Schema.String, Schema.Undefined);

export const googleAdapter: AIAdapter = {
  key: "provider:google",
  displayName: "Google",
  match: {
    providerIDs: ["google"],
  },
  listAuthMethods(ctx) {
    const methods: Array<AnyAuthMethodDefinition> = [
      createApiKeyMethod(ctx),
      {
        id: "oauth",
        type: "oauth",
        label: "OAuth with Google (Gemini CLI)",
        inputSchema: defineAuthSchema({
          projectId: {
            schema: optionalAuthStringSchema,
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

    return Effect.succeed(methods);
  },
  patchCatalog(ctx, provider) {
    if (!isGeminiOAuth(normalizeGoogleAuth(ctx.auth))) {
      return Effect.succeed(provider);
    }

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

    return Effect.succeed({
      ...provider,
      models,
    } satisfies ProviderInfo);
  },
  createModel(context) {
    return Effect.gen(function* () {
      const providerOptions = parseProviderOptions(
        googleProviderOptionsSchema,
        context.provider.options,
      );
      const execution = yield* resolveGoogleExecutionState(context);

      if (execution.kind === "oauth" && execution.projectResolutionError) {
        return yield* new RuntimeValidationError({
          message: execution.projectResolutionError,
        });
      }

      const provider = createGoogleGenerativeAI(
        buildGoogleSettings({
          providerID: context.providerID,
          providerOptions,
          headers: context.model.headers,
          execution,
        }),
      );
      const baseModel = provider.languageModel(context.model.api.id);

      if (execution.kind !== "oauth") {
        return baseModel;
      }

      return wrapLanguageModel(baseModel, (options) =>
        Effect.succeed(
          mergeModelHeaders(options, {
            "x-activity-request-id": context.requestID,
          }),
        ),
      );
    });
  },
};
