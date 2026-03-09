import { z } from "zod";
import {
  optionalMetadataString,
  parseOptionalMetadataObject,
} from "./auth-metadata";
import { defineAuthSchema } from "./schema";
import type {
  AIAdapter,
  AdapterAuthContext,
  AdapterAuthorizeContext,
  LoadedAdapterState,
  ParsedAuthRecord,
} from "./types";
import {
  getAuth,
  setAuth,
  type AuthRecord,
  type AuthResult,
} from "@/lib/runtime/auth-store";
import {
  RuntimeAuthProviderError,
  RuntimeUpstreamServiceError,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import {
  buildExtensionRedirectPath,
  generatePKCE,
  generateState,
  normalizeInstanceUrl,
} from "@/lib/runtime/oauth-util";

const CLIENT_ID =
  "6d66e9e281cd4298d71adfb271cd1baf57f18f7a186dbad4e94ca3e4ff2acb2e";
const GITLAB_COM_URL = "https://gitlab.com";
const OAUTH_SCOPES = ["api"];
const GITLAB_PROVIDER_ID = "gitlab";

type GitLabAuthMetadata = {
  instanceUrl?: string;
};

const gitLabAuthMetadataSchema = z.object({
  instanceUrl: optionalMetadataString,
});

const gitLabTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

const refreshLocks = new Map<string, Promise<void>>();

function gitlabUpstreamError(input: {
  operation: string;
  statusCode: number;
  detail?: string;
}) {
  console.error("[adapter:gitlab] upstream auth request failed", {
    operation: input.operation,
    statusCode: input.statusCode,
    detail: input.detail?.slice(0, 500),
  });

  return new RuntimeUpstreamServiceError({
    providerID: GITLAB_PROVIDER_ID,
    operation: input.operation,
    statusCode: input.statusCode,
    retryable:
      input.statusCode >= 500 ||
      input.statusCode === 429 ||
      input.statusCode === 408,
    message: "GitLab authentication request failed.",
  });
}

function gitlabAuthProviderError(input: {
  operation: string;
  message: string;
  retryable?: boolean;
}) {
  return new RuntimeAuthProviderError({
    providerID: GITLAB_PROVIDER_ID,
    operation: input.operation,
    retryable: input.retryable ?? false,
    message: input.message,
  });
}

async function exchangeAuthorizationCode(
  instanceUrl: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
) {
  const response = await fetch(`${instanceUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw gitlabUpstreamError({
      operation: "oauth.exchangeAuthorizationCode",
      statusCode: response.status,
      detail,
    });
  }

  const payload = await response.json().catch(() => undefined);
  const result = gitLabTokenResponseSchema.safeParse(payload);
  if (!result.success) {
    throw gitlabAuthProviderError({
      operation: "oauth.exchangeAuthorizationCode.parse",
      message: "GitLab OAuth token response was invalid.",
    });
  }

  return result.data;
}

async function exchangeRefreshToken(instanceUrl: string, refreshToken: string) {
  const response = await fetch(`${instanceUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw gitlabUpstreamError({
      operation: "oauth.exchangeRefreshToken",
      statusCode: response.status,
      detail,
    });
  }

  const payload = await response.json().catch(() => undefined);
  const result = gitLabTokenResponseSchema.safeParse(payload);
  if (!result.success) {
    throw gitlabAuthProviderError({
      operation: "oauth.exchangeRefreshToken.parse",
      message: "GitLab refresh token response was invalid.",
    });
  }

  return result.data;
}

async function authorizeGitLabOAuth(
  input: AdapterAuthorizeContext<Record<string, string>>,
) {
  const instanceUrl = normalizeInstanceUrl(
    input.values.instanceUrl?.trim() || GITLAB_COM_URL,
  );
  const redirectUri = input.oauth.getRedirectURL(
    buildExtensionRedirectPath(input.providerID, "oauth"),
  );
  const pkce = await generatePKCE();
  const state = generateState();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope: OAUTH_SCOPES.join(" "),
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  });

  const url = `${instanceUrl}/oauth/authorize?${params.toString()}`;
  const callbackUrl = await input.oauth.launchWebAuthFlow(url);
  const parsed = input.oauth.parseCallback(callbackUrl);

  if (parsed.error) {
    throw gitlabAuthProviderError({
      operation: "oauth.authorize",
      message: "GitLab OAuth authorization failed.",
    });
  }
  if (!parsed.code) {
    throw new RuntimeValidationError({
      message: "Missing GitLab authorization code",
    });
  }
  if (parsed.state && parsed.state !== state) {
    throw new RuntimeValidationError({
      message: "OAuth state mismatch",
    });
  }

  const tokens = await exchangeAuthorizationCode(
    instanceUrl,
    parsed.code,
    pkce.verifier,
    redirectUri,
  );

  return {
    type: "oauth" as const,
    methodID: "oauth" as const,
    methodType: "oauth" as const,
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    metadata: {
      instanceUrl,
    },
  };
}

async function authorizeGitLabPat(
  input: AdapterAuthorizeContext<Record<string, string>>,
) {
  const instanceUrl = normalizeInstanceUrl(
    input.values.instanceUrl?.trim() || GITLAB_COM_URL,
  );
  const token = input.values.token?.trim();
  if (!token) {
    throw new RuntimeValidationError({
      message: "GitLab personal access token is required",
    });
  }

  const response = await fetch(`${instanceUrl}/api/v4/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw gitlabAuthProviderError({
      operation: "pat.validate",
      message: "GitLab personal access token validation failed.",
    });
  }

  return {
    type: "api" as const,
    key: token,
    methodID: "pat" as const,
    methodType: "pat" as const,
    metadata: {
      instanceUrl,
    },
  };
}

function parseGitLabStoredAuth(
  auth?: AuthRecord,
): ParsedAuthRecord<GitLabAuthMetadata> | undefined {
  if (!auth) return undefined;
  const metadata = parseOptionalMetadataObject(
    gitLabAuthMetadataSchema,
    auth.metadata,
  );

  if (auth.type === "api") {
    return {
      ...auth,
      metadata,
    };
  }

  return {
    ...auth,
    metadata,
  };
}

function serializeGitLabAuth(input: {
  result: AuthResult<GitLabAuthMetadata>;
  method: {
    id: string;
    type: "oauth" | "pat" | "apikey";
  };
}) {
  return {
    ...input.result,
    metadata: parseOptionalMetadataObject(
      gitLabAuthMetadataSchema,
      input.result.metadata,
    ),
  };
}

export async function loadGitLabAuthState(
  ctx: AdapterAuthContext<GitLabAuthMetadata>,
): Promise<LoadedAdapterState<void>> {
  if (!ctx.auth) {
    return {
      transport: {},
      state: undefined,
    };
  }

  const instanceUrl = ctx.auth.metadata?.instanceUrl || GITLAB_COM_URL;
  if (ctx.auth.type === "api") {
    return {
      transport: {
        baseURL: instanceUrl,
        apiKey: ctx.auth.key,
        authType: "bearer",
      },
      state: undefined,
    };
  }

  const oauthAuth = ctx.auth;
  let access = ctx.auth.access;
  let refresh = ctx.auth.refresh;
  let expiresAt = ctx.auth.expiresAt;

  if (refresh && (!expiresAt || expiresAt <= Date.now() + 5 * 60_000)) {
    const lockKey = `${ctx.providerID}:${instanceUrl}`;
    const existingLock = refreshLocks.get(lockKey);
    if (existingLock) {
      await existingLock;
      const latest = await getAuth(ctx.providerID);
      if (latest?.type === "oauth") {
        access = latest.access;
        refresh = latest.refresh;
        expiresAt = latest.expiresAt;
      }
    } else {
      const task = (async () => {
        const next = await exchangeRefreshToken(instanceUrl, refresh);
        access = next.access_token;
        refresh = next.refresh_token;
        expiresAt = Date.now() + next.expires_in * 1000;
        await setAuth(ctx.providerID, {
          type: "oauth",
          access,
          refresh,
          expiresAt,
          accountId: oauthAuth.accountId,
          methodID: oauthAuth.methodID,
          methodType: oauthAuth.methodType,
          metadata: {
            instanceUrl,
          },
        });
      })();
      refreshLocks.set(lockKey, task);
      try {
        await task;
      } finally {
        refreshLocks.delete(lockKey);
      }
    }
  }

  return {
    transport: {
      baseURL: instanceUrl,
      apiKey: access,
      authType: "bearer",
    },
    state: undefined,
  };
}

export const gitlabAdapter: AIAdapter<GitLabAuthMetadata, void> = {
  key: "provider:gitlab",
  displayName: "GitLab",
  match: {
    providerIDs: ["gitlab"],
  },
  auth: {
    parseStoredAuth: parseGitLabStoredAuth,
    serializeAuth: serializeGitLabAuth,
    async methods() {
      return [
        {
          id: "oauth",
          type: "oauth",
          label: "GitLab OAuth",
          inputSchema: defineAuthSchema({
            instanceUrl: {
              schema: z.string().trim().optional(),
              ui: {
                type: "text",
                label: "GitLab instance URL",
                placeholder: "https://gitlab.com",
                required: false,
              },
            },
          }),
          authorize: authorizeGitLabOAuth,
        },
        {
          id: "pat",
          type: "pat",
          label: "GitLab Personal Access Token",
          inputSchema: defineAuthSchema({
            instanceUrl: {
              schema: z.string().trim().optional(),
              ui: {
                type: "text",
                label: "GitLab instance URL",
                placeholder: "https://gitlab.com",
                required: false,
              },
            },
            token: {
              schema: z.string().trim().min(1, "GitLab personal access token is required"),
              ui: {
                type: "secret",
                label: "Personal Access Token",
                placeholder: "glpat-xxxxxxxxxxxxxxxxxxxx",
                required: true,
              },
            },
          }),
          authorize: authorizeGitLabPat,
        },
      ];
    },
    async load(ctx) {
      if (!ctx.auth) {
        return {
          transport: {},
          state: undefined,
        };
      }
      return loadGitLabAuthState(ctx);
    },
  },
  async createModel() {
    throw new Error(
      "GitLab model execution is not supported in the browser runtime.",
    );
  },
};
