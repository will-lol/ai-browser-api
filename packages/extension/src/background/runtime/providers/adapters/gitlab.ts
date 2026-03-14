import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { decodeSchemaOrUndefined } from "@/background/runtime/core/effect-schema";
import { defineAuthSchema } from "./schema";
import type { AIAdapter, AdapterAuthorizeContext } from "./types";
import {
  isRuntimeRpcError,
  RuntimeAuthProviderError,
  RuntimeInternalError,
  RuntimeUpstreamServiceError,
  RuntimeValidationError,
} from "@llm-bridge/contracts";
import {
  buildExtensionRedirectPath,
  generatePKCE,
  generateState,
  normalizeInstanceUrl,
} from "@/background/runtime/auth/oauth-util";

const CLIENT_ID =
  "6d66e9e281cd4298d71adfb271cd1baf57f18f7a186dbad4e94ca3e4ff2acb2e";
const GITLAB_COM_URL = "https://gitlab.com";
const OAUTH_SCOPES = ["api"];
const GITLAB_PROVIDER_ID = "gitlab";

const gitLabTokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
});

const optionalAuthStringSchema = Schema.Union(Schema.String, Schema.Undefined);
const requiredAuthStringSchema = Schema.String.pipe(Schema.minLength(1));

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

function exchangeAuthorizationCode(
  instanceUrl: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
) {
  return Effect.tryPromise({
    try: async () => {
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
      const result = decodeSchemaOrUndefined(gitLabTokenResponseSchema, payload);
      if (!result) {
        throw gitlabAuthProviderError({
          operation: "oauth.exchangeAuthorizationCode.parse",
          message: "GitLab OAuth token response was invalid.",
        });
      }

      return result;
    },
    catch: (error) =>
      isRuntimeRpcError(error)
        ? error
        : gitlabAuthProviderError({
            operation: "oauth.exchangeAuthorizationCode",
            message: error instanceof Error ? error.message : String(error),
          }),
  });
}

function authorizeGitLabOAuth(
  input: AdapterAuthorizeContext<Record<string, string | undefined>>,
) {
  return Effect.gen(function* () {
    const instanceUrl = normalizeInstanceUrl(
      input.values.instanceUrl?.trim() || GITLAB_COM_URL,
    );
    const redirectUri = yield* Effect.try({
      try: () =>
        input.oauth.getRedirectURL(
          buildExtensionRedirectPath(input.providerID, "oauth"),
        ),
      catch: (error) =>
        isRuntimeRpcError(error)
          ? error
          : gitlabAuthProviderError({
              operation: "oauth.getRedirectURL",
              message: error instanceof Error ? error.message : String(error),
            }),
    });
    const pkce = yield* generatePKCE().pipe(
      Effect.mapError((error) =>
        gitlabAuthProviderError({
          operation: "oauth.generatePKCE",
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
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
    const callbackUrl = yield* input.oauth.launchWebAuthFlow(url);
    const parsed = input.oauth.parseCallback(callbackUrl);

    if (parsed.error) {
      return yield* Effect.fail(
        gitlabAuthProviderError({
          operation: "oauth.authorize",
          message: "GitLab OAuth authorization failed.",
        }),
      );
    }
    if (!parsed.code) {
      return yield* new RuntimeValidationError({
        message: "Missing GitLab authorization code",
      });
    }
    if (parsed.state && parsed.state !== state) {
      return yield* new RuntimeValidationError({
        message: "OAuth state mismatch",
      });
    }

    const tokens = yield* exchangeAuthorizationCode(
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
  });
}

function authorizeGitLabPat(
  input: AdapterAuthorizeContext<Record<string, string | undefined>>,
) {
  return Effect.gen(function* () {
    const instanceUrl = normalizeInstanceUrl(
      input.values.instanceUrl?.trim() || GITLAB_COM_URL,
    );
    const token = input.values.token?.trim();
    if (!token) {
      return yield* new RuntimeValidationError({
        message: "GitLab personal access token is required",
      });
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${instanceUrl}/api/v4/user`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      catch: (error) =>
        gitlabAuthProviderError({
          operation: "pat.validate",
          message: error instanceof Error ? error.message : String(error),
        }),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        gitlabAuthProviderError({
          operation: "pat.validate",
          message: "GitLab personal access token validation failed.",
        }),
      );
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
  });
}

export const gitlabAdapter: AIAdapter = {
  key: "provider:gitlab",
  displayName: "GitLab",
  match: {
    providerIDs: ["gitlab"],
  },
  listAuthMethods() {
    return Effect.succeed([
      {
        id: "oauth",
        type: "oauth",
        label: "GitLab OAuth",
        inputSchema: defineAuthSchema({
          instanceUrl: {
            schema: optionalAuthStringSchema,
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
            schema: optionalAuthStringSchema,
            ui: {
              type: "text",
              label: "GitLab instance URL",
              placeholder: "https://gitlab.com",
              required: false,
            },
          },
          token: {
            schema: requiredAuthStringSchema,
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
    ]);
  },
  createModel() {
    return Effect.fail(
      new RuntimeInternalError({
        operation: "adapter.createModel",
        message: "GitLab model execution is not supported in the browser runtime.",
      }),
    );
  },
};
