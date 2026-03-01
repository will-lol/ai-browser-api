import { browser } from "@wxt-dev/browser"
import { getAuth, setAuth } from "@/lib/runtime/auth-store"
import {
  generatePKCE,
  generateState,
  normalizeInstanceUrl,
  parseOAuthCallbackInput,
} from "@/lib/runtime/plugins/oauth-util"
import type { RuntimePlugin } from "@/lib/runtime/plugin-manager"

const CLIENT_ID =
  "1d89f9fdb23ee96d4e603201f6861dab6e143c5c3c00469a018a2d94bdc03d4e"
const GITLAB_COM_URL = "https://gitlab.com"
const OAUTH_SCOPES = ["api"]

type PendingGitLabOAuth = {
  state: string
  codeVerifier: string
  redirectUri: string
  instanceUrl: string
}

type GitLabTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
}

const refreshLocks = new Map<string, Promise<void>>()

function resolvePendingGitLabOAuth(value: unknown): PendingGitLabOAuth {
  if (!value || typeof value !== "object") {
    throw new Error("GitLab OAuth session context is missing")
  }

  const input = value as Record<string, unknown>
  const state = typeof input.state === "string" ? input.state : ""
  const codeVerifier = typeof input.codeVerifier === "string" ? input.codeVerifier : ""
  const redirectUri = typeof input.redirectUri === "string" ? input.redirectUri : ""
  const instanceUrl = typeof input.instanceUrl === "string" ? input.instanceUrl : ""

  if (!state || !codeVerifier || !redirectUri || !instanceUrl) {
    throw new Error("GitLab OAuth session context is invalid")
  }

  return {
    state,
    codeVerifier,
    redirectUri,
    instanceUrl,
  }
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
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`GitLab token exchange failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return (await response.json()) as GitLabTokenResponse
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
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`GitLab token refresh failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return (await response.json()) as GitLabTokenResponse
}

export const gitlabAuthPlugin: RuntimePlugin = {
  id: "builtin-gitlab-auth",
  name: "Builtin GitLab Auth",
  supportedProviders: ["gitlab"],
  hooks: {
    auth: {
      async methods() {
        return [
          {
            type: "oauth",
            mode: "browser",
            label: "GitLab OAuth",
            fields: [
              {
                type: "text",
                key: "instanceUrl",
                label: "GitLab instance URL",
                placeholder: "https://gitlab.com",
                required: false,
              },
            ],
          },
          {
            type: "api",
            label: "GitLab Personal Access Token",
            fields: [
              {
                type: "text",
                key: "instanceUrl",
                label: "GitLab instance URL",
                placeholder: "https://gitlab.com",
                required: false,
              },
              {
                type: "secret",
                key: "token",
                label: "Personal Access Token",
                placeholder: "glpat-xxxxxxxxxxxxxxxxxxxx",
                required: true,
              },
            ],
          },
        ]
      },
      async authorize(_ctx, method, input, info) {
        if (method.type === "api" && info.methodIndex === 1) {
          const instanceUrl = normalizeInstanceUrl(input.instanceUrl?.trim() || GITLAB_COM_URL)
          const token = input.token?.trim()
          if (!token) {
            throw new Error("GitLab personal access token is required")
          }

          const response = await fetch(`${instanceUrl}/api/v4/user`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })

          if (!response.ok) {
            throw new Error("GitLab personal access token validation failed")
          }

          return {
            type: "api",
            key: token,
            metadata: {
              authMode: "gitlab_pat",
              instanceUrl,
            },
          }
        }

        if (method.type === "oauth" && info.methodIndex === 0) {
          const instanceUrl = normalizeInstanceUrl(input.instanceUrl?.trim() || GITLAB_COM_URL)
          const redirectUri = browser.identity?.getRedirectURL("gitlab-oauth") ?? "https://localhost.invalid/gitlab-oauth"
          const pkce = await generatePKCE()
          const state = generateState()

          const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: "code",
            state,
            scope: OAUTH_SCOPES.join(" "),
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
          })

          const url = `${instanceUrl}/oauth/authorize?${params.toString()}`
          return {
            authorization: {
              mode: "auto",
              url,
              instructions: "Complete GitLab OAuth in your browser.",
            },
            context: {
              state,
              codeVerifier: pkce.verifier,
              redirectUri,
              instanceUrl,
            },
          }
        }

        return undefined
      },
      async callback(_ctx, method, input, info) {
        if (method.type !== "oauth" || info.methodIndex !== 0) return undefined

        const pending = resolvePendingGitLabOAuth(input.context)

        const parsed = parseOAuthCallbackInput(input)
        if (!parsed.code) throw new Error("Missing GitLab authorization code")
        if (parsed.state && parsed.state !== pending.state) {
          throw new Error("OAuth state mismatch")
        }

        const tokens = await exchangeAuthorizationCode(
          pending.instanceUrl,
          parsed.code,
          pending.codeVerifier,
          pending.redirectUri,
        )

        return {
          type: "oauth",
          access: tokens.access_token,
          refresh: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          metadata: {
            authMode: "gitlab_oauth",
            instanceUrl: pending.instanceUrl,
          },
        }
      },
      async loader(ctx) {
        if (!ctx.auth) return {}

        const instanceUrl = ctx.auth.metadata?.instanceUrl || GITLAB_COM_URL
        if (ctx.auth.type === "api") {
          return {
            $baseURL: instanceUrl,
            $apiKey: ctx.auth.key,
            $authType: "bearer",
          }
        }

        const oauthAuth = ctx.auth
        let access = oauthAuth.access
        let refresh = oauthAuth.refresh
        let expiresAt = oauthAuth.expiresAt

        if (refresh && (!expiresAt || expiresAt <= Date.now() + 5 * 60_000)) {
          const lockKey = `${ctx.providerID}:${instanceUrl}`
          const existingLock = refreshLocks.get(lockKey)
          if (existingLock) {
            await existingLock
            const latest = await getAuth(ctx.providerID)
            if (latest?.type === "oauth") {
              access = latest.access
              refresh = latest.refresh
              expiresAt = latest.expiresAt
            }
          } else {
            const task = (async () => {
              const next = await exchangeRefreshToken(instanceUrl, refresh)
              access = next.access_token
              refresh = next.refresh_token
              expiresAt = Date.now() + next.expires_in * 1000
              await setAuth(ctx.providerID, {
                type: "oauth",
                access,
                refresh,
                expiresAt,
                accountId: oauthAuth.accountId,
                metadata: {
                  ...(oauthAuth.metadata ?? {}),
                  authMode: "gitlab_oauth",
                  instanceUrl,
                },
              })
            })()
            refreshLocks.set(lockKey, task)
            try {
              await task
            } finally {
              refreshLocks.delete(lockKey)
            }
          }
        }

        return {
          $baseURL: instanceUrl,
          $apiKey: access,
          $authType: "bearer",
        }
      },
    },
  },
}
