import { setAuth } from "@/lib/runtime/auth-store"
import {
  buildExtensionRedirectPath,
  generatePKCE,
  generateState,
} from "@/lib/runtime/plugins/oauth-util"
import type { RuntimePlugin } from "@/lib/runtime/plugin-manager"

const GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const GEMINI_CLIENT_SECRET = "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"
const GEMINI_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
}

async function exchangeAuthorizationCode(code: string, verifier: string, redirectUri: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Gemini OAuth exchange failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return (await response.json()) as GoogleTokenResponse
}

async function refreshAccessToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Gemini token refresh failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return (await response.json()) as GoogleTokenResponse
}

async function resolveUserEmail(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!response.ok) return undefined
  const payload = (await response.json()) as { email?: string }
  return payload.email
}

function isGeminiOAuth(metadata?: Record<string, string>) {
  return metadata?.authMode === "gemini_oauth"
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
              const redirectUri = input.oauth.getRedirectURL(
                buildExtensionRedirectPath(input.providerID, "oauth"),
              )
              const pkce = await generatePKCE()
              const state = generateState()

              const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
              url.searchParams.set("client_id", GEMINI_CLIENT_ID)
              url.searchParams.set("response_type", "code")
              url.searchParams.set("redirect_uri", redirectUri)
              url.searchParams.set("scope", GEMINI_SCOPES.join(" "))
              url.searchParams.set("code_challenge", pkce.challenge)
              url.searchParams.set("code_challenge_method", "S256")
              url.searchParams.set("state", state)
              url.searchParams.set("access_type", "offline")
              url.searchParams.set("prompt", "consent")
              url.hash = "llm-bridge"

              const callbackUrl = await input.oauth.launchWebAuthFlow(url.toString())
              const parsed = input.oauth.parseCallback(callbackUrl)

              if (parsed.error) {
                throw new Error(`Google OAuth failed: ${parsed.errorDescription ?? parsed.error}`)
              }
              if (!parsed.code) throw new Error("Missing Google authorization code")
              if (parsed.state && parsed.state !== state) {
                throw new Error("OAuth state mismatch")
              }

              const tokens = await exchangeAuthorizationCode(parsed.code, pkce.verifier, redirectUri)
              if (!tokens.refresh_token) {
                throw new Error("Missing refresh token in Google OAuth response")
              }

              const projectId = input.values.projectId?.trim() || undefined
              const email = await resolveUserEmail(tokens.access_token)
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
              }
            },
          },
        ]
      },
      async loader(auth, _provider, ctx) {
        if (auth?.type !== "oauth" || !isGeminiOAuth(auth.metadata)) return {}

        let access = auth.access
        let refresh = auth.refresh
        let expiresAt = auth.expiresAt

        if (refresh && (!expiresAt || expiresAt <= Date.now() + 60_000)) {
          const refreshed = await refreshAccessToken(refresh)
          access = refreshed.access_token
          refresh = refreshed.refresh_token ?? refresh
          expiresAt = Date.now() + refreshed.expires_in * 1000

          await setAuth(ctx.providerID, {
            type: "oauth",
            access,
            refresh,
            expiresAt,
            metadata: {
              ...(auth.metadata ?? {}),
              authMode: "gemini_oauth",
            },
          })
        }

        return {
          $apiKey: access,
          $authType: "bearer",
          $headers: {
            "X-Goog-Api-Client": "gl-node/22.17.0",
            "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
          },
        }
      },
    },
    provider: {
      async patchProvider(ctx, provider) {
        if (!isGeminiOAuth(ctx.auth?.metadata)) return undefined
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
        )

        return {
          ...provider,
          models,
        }
      },
    },
    chat: {
      async headers(ctx, headers) {
        if (ctx.providerID !== "google") return undefined
        return {
          strategy: "merge",
          value: {
            ...headers,
            "x-activity-request-id": ctx.requestID,
          },
        }
      },
    },
  },
}
