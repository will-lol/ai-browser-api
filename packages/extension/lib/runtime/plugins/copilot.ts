import { browser } from "@wxt-dev/browser"
import { setAuth } from "@/lib/runtime/auth-store"
import { normalizeDomain, sleep } from "@/lib/runtime/plugins/oauth-util"
import type { RuntimePlugin } from "@/lib/runtime/plugin-manager"
import { isObject } from "@/lib/runtime/util"

const CLIENT_ID = "Iv1.b507a08c87ecfe98"
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000

const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
} as const

const RESPONSES_API_ALTERNATE_INPUT_TYPES = new Set([
  "file_search_call",
  "computer_call",
  "computer_call_output",
  "web_search_call",
  "function_call",
  "function_call_output",
  "image_generation_call",
  "code_interpreter_call",
  "local_shell_call",
  "local_shell_call_output",
  "mcp_list_tools",
  "mcp_approval_request",
  "mcp_approval_response",
  "mcp_call",
  "reasoning",
])

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Authentication canceled")
  }
}

function getUrls(domain: string) {
  return {
    deviceCodeURL: `https://${domain}/login/device/code`,
    accessTokenURL: `https://${domain}/login/oauth/access_token`,
    copilotApiKeyURL: `https://api.${domain}/copilot_internal/v2/token`,
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function inspectCopilotRequest(options: Record<string, unknown>) {
  let isAgent = false
  let isVision = false

  const messages = Array.isArray(options.messages) ? options.messages : undefined
  if (messages && messages.length > 0) {
    const last = messages[messages.length - 1]
    if (isObject(last)) {
      const role = readString(last.role)
      isAgent = role === "assistant" || role === "tool"
    }

    isVision = messages.some((message) => {
      if (!isObject(message)) return false
      if (!Array.isArray(message.content)) return false
      return message.content.some((part) => {
        if (!isObject(part)) return false
        return part.type === "image_url"
      })
    })
  }

  const input = Array.isArray(options.input) ? options.input : undefined
  if (input && input.length > 0) {
    const lastInput = input[input.length - 1]
    if (isObject(lastInput)) {
      const role = readString(lastInput.role)
      const inputType = readString(lastInput.type)
      const hasAgentType = Boolean(inputType && RESPONSES_API_ALTERNATE_INPUT_TYPES.has(inputType))
      if (role === "assistant" || hasAgentType) {
        isAgent = true
      }

      const content = Array.isArray(lastInput.content) ? lastInput.content : undefined
      if (
        content
        && content.some((part) => {
          if (!isObject(part)) return false
          return part.type === "input_image"
        })
      ) {
        isVision = true
      }
    }
  }

  return {
    isVision,
    isAgent,
  }
}

function buildVerificationUrl(input: { verificationUri: string; userCode: string }) {
  try {
    const url = new URL(input.verificationUri)
    url.searchParams.set("user_code", input.userCode)
    return url.toString()
  } catch {
    const separator = input.verificationUri.includes("?") ? "&" : "?"
    return `${input.verificationUri}${separator}user_code=${encodeURIComponent(input.userCode)}`
  }
}

function shouldRefreshCopilotAccessToken(input: {
  access?: string
  expiresAt?: number
  now: number
}) {
  if (!input.access) return true
  if (!input.expiresAt) return true
  return input.expiresAt <= input.now + 60_000
}

export const copilotAuthPlugin: RuntimePlugin = {
  id: "builtin-copilot-auth",
  name: "Builtin Copilot Auth",
  supportedProviders: ["github-copilot"],
  hooks: {
    auth: {
      provider: "github-copilot",
      async methods() {
        return [
          {
            id: "oauth-device",
            type: "oauth",
            label: "Login with GitHub Copilot",
            fields: [
              {
                type: "select",
                key: "deploymentType",
                label: "Deployment Type",
                required: false,
                defaultValue: "github.com",
                options: [
                  {
                    label: "GitHub.com",
                    value: "github.com",
                  },
                  {
                    label: "Enterprise",
                    value: "enterprise",
                  },
                ],
              },
              {
                type: "text",
                key: "enterpriseUrl",
                label: "Enterprise URL (if using enterprise)",
                placeholder: "company.ghe.com",
                required: false,
                condition: {
                  key: "deploymentType",
                  equals: "enterprise",
                },
              },
            ],
            async authorize(input) {
              const deploymentType = input.values.deploymentType?.trim().toLowerCase()
              const enterpriseInput = input.values.enterpriseUrl?.trim()
              const enterprise = deploymentType === "enterprise" || Boolean(enterpriseInput)

              const domain = enterprise && enterpriseInput ? normalizeDomain(enterpriseInput) : "github.com"
              const urls = getUrls(domain)

              const deviceResponse = await fetch(urls.deviceCodeURL, {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                  "User-Agent": COPILOT_HEADERS["User-Agent"],
                },
                body: JSON.stringify({
                  client_id: CLIENT_ID,
                  scope: "read:user",
                }),
              })

              if (!deviceResponse.ok) {
                const detail = await deviceResponse.text().catch(() => "")
                throw new Error(`Failed to initiate Copilot device authorization (${deviceResponse.status}): ${detail.slice(0, 300)}`)
              }

              const deviceData = (await deviceResponse.json()) as {
                verification_uri: string
                user_code: string
                device_code: string
                interval: number
                expires_in?: number
              }

              const verificationUrl = buildVerificationUrl({
                verificationUri: deviceData.verification_uri,
                userCode: deviceData.user_code,
              })

              let autoOpened = false
              await browser.tabs.create({
                url: verificationUrl,
              }).then(() => {
                autoOpened = true
              }).catch(() => {
                // Ignore tab creation errors and continue polling for completion.
              })

              await input.authFlow.publish({
                kind: "device_code",
                title: "Enter the device code to continue",
                message: "Open the verification page and enter this code to finish signing in.",
                code: deviceData.user_code,
                url: verificationUrl,
                autoOpened,
              })

              const signal = input.signal
              const expiresInMs = Math.max(deviceData.expires_in ?? 900, 30) * 1000
              const deadline = Date.now() + expiresInMs
              let intervalSeconds = Math.max(deviceData.interval || 5, 1)

              while (Date.now() < deadline) {
                throwIfAborted(signal)
                const response = await fetch(urls.accessTokenURL, {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "User-Agent": COPILOT_HEADERS["User-Agent"],
                  },
                  body: JSON.stringify({
                    client_id: CLIENT_ID,
                    device_code: deviceData.device_code,
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                  }),
                })

                if (!response.ok) {
                  const detail = await response.text().catch(() => "")
                  throw new Error(`Copilot token polling failed (${response.status}): ${detail.slice(0, 300)}`)
                }

                const data = (await response.json()) as {
                  access_token?: string
                  error?: string
                  error_description?: string
                  interval?: number
                }

                if (data.access_token) {
                  return {
                    type: "oauth",
                    access: "",
                    refresh: data.access_token,
                    expiresAt: 0,
                    metadata: {
                      authMode: "copilot_oauth",
                      ...(enterprise ? { enterpriseUrl: domain } : {}),
                    },
                  }
                }

                if (data.error === "authorization_pending") {
                  await sleep(intervalSeconds * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS)
                  throwIfAborted(signal)
                  continue
                }

                if (data.error === "slow_down") {
                  intervalSeconds = data.interval && data.interval > 0 ? data.interval : intervalSeconds + 5
                  await sleep(intervalSeconds * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS)
                  throwIfAborted(signal)
                  continue
                }

                throw new Error(`Copilot authorization failed: ${data.error_description ?? data.error ?? "unknown_error"}`)
              }

              throw new Error(`Copilot device authorization timed out. Enter code: ${deviceData.user_code}`)
            },
          },
        ]
      },
      async loader(auth, _provider, ctx) {
        if (auth?.type !== "oauth") return {}

        const enterpriseUrl = auth.metadata?.enterpriseUrl
        const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : "github.com"
        const baseURL = enterpriseUrl ? `https://copilot-api.${normalizeDomain(enterpriseUrl)}` : "https://api.githubcopilot.com"
        const urls = getUrls(domain)

        let access = auth.access
        const refresh = auth.refresh
        const expiresAt = auth.expiresAt

        if (shouldRefreshCopilotAccessToken({
          access,
          expiresAt,
          now: Date.now(),
        }) && refresh) {
          const response = await fetch(urls.copilotApiKeyURL, {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${refresh}`,
              ...COPILOT_HEADERS,
            },
          })

          if (!response.ok) {
            const detail = await response.text().catch(() => "")
            throw new Error(`Copilot token refresh failed (${response.status}): ${detail.slice(0, 300)}`)
          }

          const tokenData = (await response.json()) as {
            token?: string
            expires_at?: number
          }

          if (!tokenData.token) {
            throw new Error("Copilot token refresh failed: missing token")
          }

          access = tokenData.token
          await setAuth(ctx.providerID, {
            type: "oauth",
            access,
            refresh,
            expiresAt: typeof tokenData.expires_at === "number"
              ? tokenData.expires_at * 1000 - 5 * 60 * 1000
              : Date.now() + 25 * 60_000,
            accountId: auth.accountId,
            metadata: {
              ...(auth.metadata ?? {}),
              ...(enterpriseUrl ? { enterpriseUrl: normalizeDomain(enterpriseUrl) } : {}),
              authMode: "copilot_oauth",
            },
          })
        }

        if (!access) {
          throw new Error("Copilot OAuth access token is unavailable. Reconnect GitHub Copilot and retry.")
        }

        return {
          transport: {
            baseURL,
            apiKey: access,
            authType: "bearer",
          },
        }
      },
    },
    provider: {
      async patchModel(_ctx, model) {
        return {
          ...model,
          api: {
            ...model.api,
            npm: "@ai-sdk/github-copilot",
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
      },
      async requestOptions(_ctx, options) {
        const { isVision, isAgent } = inspectCopilotRequest(options)

        return {
          strategy: "merge",
          value: {
            headers: {
              ...COPILOT_HEADERS,
              "X-Initiator": isAgent ? "agent" : "user",
              "Openai-Intent": "conversation-edits",
              ...(isVision ? { "Copilot-Vision-Request": "true" } : {}),
            },
          },
        }
      },
    },
    chat: {
      async headers(_ctx, headers) {
        return {
          strategy: "merge",
          value: {
            ...headers,
          },
        }
      },
    },
  },
}
