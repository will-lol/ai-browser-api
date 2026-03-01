import { browser } from "@wxt-dev/browser"
import { setAuth } from "@/lib/runtime/auth-store"
import type { AuthRecord } from "@/lib/runtime/auth-store"
import type { RuntimePlugin } from "@/lib/runtime/plugin-manager"
import { generatePKCE, generateState, parseOAuthCallbackInput, sleep } from "@/lib/runtime/plugins/oauth-util"
import type { ProviderInfo, ProviderModelInfo } from "@/lib/runtime/provider-registry"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_BASE = "https://chatgpt.com/backend-api/codex"
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000

type TokenResponse = {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

type PendingBrowserAuth = {
  verifier: string
  state: string
  redirectUri: string
}

type PendingDeviceAuth = {
  deviceAuthId: string
  userCode: string
  intervalMs: number
}

function resolvePendingBrowserAuth(value: unknown): PendingBrowserAuth {
  if (!value || typeof value !== "object") {
    throw new Error("Codex browser auth context is missing")
  }

  const input = value as Record<string, unknown>
  const verifier = typeof input.verifier === "string" ? input.verifier : ""
  const state = typeof input.state === "string" ? input.state : ""
  const redirectUri = typeof input.redirectUri === "string" ? input.redirectUri : ""

  if (!verifier || !state || !redirectUri) {
    throw new Error("Codex browser auth context is invalid")
  }

  return {
    verifier,
    state,
    redirectUri,
  }
}

function resolvePendingDeviceAuth(value: unknown): PendingDeviceAuth {
  if (!value || typeof value !== "object") {
    throw new Error("Codex device auth context is missing")
  }

  const input = value as Record<string, unknown>
  const deviceAuthId = typeof input.deviceAuthId === "string" ? input.deviceAuthId : ""
  const userCode = typeof input.userCode === "string" ? input.userCode : ""
  const intervalMs = typeof input.intervalMs === "number" ? input.intervalMs : 0

  if (!deviceAuthId || !userCode || intervalMs <= 0) {
    throw new Error("Codex device auth context is invalid")
  }

  return {
    deviceAuthId,
    userCode,
    intervalMs,
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Authentication canceled")
  }
}

function decodeJwtPayload(token: string) {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined

  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4)
  try {
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function extractAccountId(tokens: TokenResponse) {
  const candidates = [tokens.id_token, tokens.access_token].filter((token): token is string => !!token)
  for (const token of candidates) {
    const claims = decodeJwtPayload(token)
    if (!claims) continue

    const direct = typeof claims.chatgpt_account_id === "string" ? claims.chatgpt_account_id : undefined
    if (direct) return direct

    const nested = claims["https://api.openai.com/auth"]
    if (nested && typeof nested === "object") {
      const next = (nested as Record<string, unknown>).chatgpt_account_id
      if (typeof next === "string") return next
    }

    if (Array.isArray(claims.organizations)) {
      const first = claims.organizations[0]
      if (first && typeof first === "object" && typeof (first as Record<string, unknown>).id === "string") {
        return (first as Record<string, string>).id
      }
    }
  }
  return undefined
}

async function exchangeCodeForTokens(code: string, redirectUri: string, verifier: string) {
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
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Codex token exchange failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return (await response.json()) as TokenResponse
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
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`Codex token refresh failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return (await response.json()) as TokenResponse
}

function buildCodexOAuthProvider(provider: ProviderInfo) {
  const allowedModels = new Set([
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.1-codex",
  ])

  const models: Record<string, ProviderModelInfo> = {}
  for (const [modelID, model] of Object.entries(provider.models)) {
    if (!modelID.includes("codex") && !allowedModels.has(modelID)) continue
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
    }
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
    }
  }

  return {
    ...provider,
    models,
  }
}

function isCodexOAuth(auth?: AuthRecord): auth is Extract<AuthRecord, { type: "oauth" }> {
  return auth?.type === "oauth" && auth.metadata?.authMode === "codex_oauth"
}

export const codexAuthPlugin: RuntimePlugin = {
  id: "builtin-codex-auth",
  name: "Builtin Codex Auth",
  supportedProviders: ["openai"],
  hooks: {
    auth: {
      async methods() {
        return [
          {
            type: "oauth",
            mode: "browser",
            label: "ChatGPT Pro/Plus (browser)",
          },
          {
            type: "oauth",
            mode: "device",
            label: "ChatGPT Pro/Plus (headless)",
          },
        ]
      },
      async authorize(_ctx, method, _input, info) {
        if (method.type !== "oauth") return undefined

        if (info.methodIndex === 0) {
          const redirectUri = browser.identity?.getRedirectURL("openai-codex") ?? "https://localhost.invalid/openai-codex"
          const pkce = await generatePKCE()
          const state = generateState()

          const params = new URLSearchParams({
            response_type: "code",
            client_id: CLIENT_ID,
            redirect_uri: redirectUri,
            scope: "openid profile email offline_access",
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
            id_token_add_organizations: "true",
            codex_cli_simplified_flow: "true",
            state,
            originator: "llm-bridge",
          })

          return {
            authorization: {
              mode: "auto",
              url: `${ISSUER}/oauth/authorize?${params.toString()}`,
              instructions: "Complete authorization in your browser.",
            },
            context: {
              verifier: pkce.verifier,
              state,
              redirectUri,
            },
          }
        }

        if (info.methodIndex === 1) {
          const response = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "llm-bridge",
            },
            body: JSON.stringify({
              client_id: CLIENT_ID,
            }),
          })

          if (!response.ok) {
            const detail = await response.text().catch(() => "")
            throw new Error(`Failed to start Codex device auth (${response.status}): ${detail.slice(0, 300)}`)
          }

          const data = (await response.json()) as {
            device_auth_id: string
            user_code: string
            interval: string
          }

          return {
            authorization: {
              mode: "auto",
              url: `${ISSUER}/codex/device`,
              instructions: `Enter code: ${data.user_code}`,
            },
            context: {
              deviceAuthId: data.device_auth_id,
              userCode: data.user_code,
              intervalMs: Math.max(parseInt(data.interval, 10) || 5, 1) * 1000,
            },
          }
        }

        return undefined
      },
      async callback(_ctx, method, input, info) {
        if (method.type !== "oauth") return undefined

        if (info.methodIndex === 0) {
          const pending = resolvePendingBrowserAuth(input.context)
          const parsed = parseOAuthCallbackInput(input)
          if (!parsed.code) throw new Error("Missing authorization code")
          if (parsed.state && parsed.state !== pending.state) {
            throw new Error("OAuth state mismatch")
          }

          const tokens = await exchangeCodeForTokens(parsed.code, pending.redirectUri, pending.verifier)
          const accountId = extractAccountId(tokens)

          return {
            type: "oauth",
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
            accountId,
            metadata: {
              authMode: "codex_oauth",
              ...(accountId ? { accountId } : {}),
            },
          }
        }

        if (info.methodIndex === 1) {
          const pending = resolvePendingDeviceAuth(input.context)
          const signal = input.signal
          const deadline = Date.now() + 5 * 60_000
          while (Date.now() < deadline) {
            throwIfAborted(signal)
            const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "llm-bridge",
              },
              body: JSON.stringify({
                device_auth_id: pending.deviceAuthId,
                user_code: pending.userCode,
              }),
            })

            if (response.ok) {
              const payload = (await response.json()) as {
                authorization_code: string
                code_verifier: string
              }

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
              })

              if (!tokenResponse.ok) {
                const detail = await tokenResponse.text().catch(() => "")
                throw new Error(`Codex device token exchange failed (${tokenResponse.status}): ${detail.slice(0, 300)}`)
              }

              const tokens = (await tokenResponse.json()) as TokenResponse
              const accountId = extractAccountId(tokens)
              return {
                type: "oauth",
                access: tokens.access_token,
                refresh: tokens.refresh_token,
                expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                accountId,
                metadata: {
                  authMode: "codex_oauth",
                  ...(accountId ? { accountId } : {}),
                },
              }
            }

            if (response.status !== 403 && response.status !== 404) {
              const detail = await response.text().catch(() => "")
              throw new Error(`Codex device auth failed (${response.status}): ${detail.slice(0, 300)}`)
            }

            await sleep(pending.intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS)
            throwIfAborted(signal)
          }

          throw new Error("Codex device authorization timed out")
        }

        return undefined
      },
      async loader(ctx) {
        if (!isCodexOAuth(ctx.auth)) return {}

        let access = ctx.auth.access
        let refresh = ctx.auth.refresh
        let expiresAt = ctx.auth.expiresAt
        const accountId = ctx.auth.accountId ?? ctx.auth.metadata?.accountId

        if (refresh && (!expiresAt || expiresAt <= Date.now() + 60_000)) {
          const refreshed = await refreshAccessToken(refresh)
          const nextAccountId = extractAccountId(refreshed) ?? accountId
          access = refreshed.access_token
          refresh = refreshed.refresh_token
          expiresAt = Date.now() + (refreshed.expires_in ?? 3600) * 1000

          await setAuth(ctx.providerID, {
            type: "oauth",
            access,
            refresh,
            expiresAt,
            accountId: nextAccountId,
            metadata: {
              ...(ctx.auth.metadata ?? {}),
              authMode: "codex_oauth",
              ...(nextAccountId ? { accountId: nextAccountId } : {}),
            },
          })
        }

        return {
          $baseURL: CODEX_API_BASE,
          $apiKey: access,
          $authType: "bearer",
          $headers: {
            ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
          },
        }
      },
    },
    provider: {
      async patchProvider(ctx, provider) {
        if (!isCodexOAuth(ctx.auth)) return undefined
        return buildCodexOAuthProvider(provider)
      },
    },
    chat: {
      async headers(ctx, headers) {
        if (ctx.providerID !== "openai") return undefined
        return {
          strategy: "merge",
          value: {
            ...headers,
            originator: "llm-bridge",
            session_id: ctx.sessionID,
            "User-Agent": "llm-bridge",
          },
        }
      },
    },
  },
}
