import { browser } from "@wxt-dev/browser"
import { normalizeDomain, sleep } from "@/lib/runtime/plugins/oauth-util"
import type { RuntimePlugin } from "@/lib/runtime/plugin-manager"
import { isObject } from "@/lib/runtime/util"

const CLIENT_ID = "Ov23li8tweQw6odWQebz"
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Authentication canceled")
  }
}

function getUrls(domain: string) {
  return {
    deviceCodeURL: `https://${domain}/login/device/code`,
    accessTokenURL: `https://${domain}/login/oauth/access_token`,
  }
}

function inspectCopilotRequest(options: Record<string, unknown>) {
  const messages = Array.isArray(options.messages) ? options.messages : undefined
  if (!messages || messages.length === 0) {
    return {
      isVision: false,
      isAgent: false,
    }
  }

  const last = messages[messages.length - 1]
  const isAgent = isObject(last) ? last.role !== "user" : false

  const isVision = messages.some((message) => {
    if (!isObject(message)) return false
    if (!Array.isArray(message.content)) return false
    return message.content.some((part) => {
      if (!isObject(part)) return false
      return part.type === "image_url" || part.type === "image"
    })
  })

  return {
    isVision,
    isAgent,
  }
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
                  "User-Agent": "llm-bridge",
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
              }

              await browser.tabs.create({
                url: deviceData.verification_uri,
              }).catch(() => {
                // Ignore tab creation errors and continue polling for completion.
              })

              const signal = input.signal
              const deadline = Date.now() + 10 * 60_000
              const intervalSeconds = Math.max(deviceData.interval || 5, 1)

              while (Date.now() < deadline) {
                throwIfAborted(signal)
                const response = await fetch(urls.accessTokenURL, {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "User-Agent": "llm-bridge",
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
                  interval?: number
                }

                if (data.access_token) {
                  return {
                    type: "oauth",
                    access: data.access_token,
                    refresh: data.access_token,
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
                  const nextInterval = data.interval && data.interval > 0 ? data.interval : intervalSeconds + 5
                  await sleep(nextInterval * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS)
                  throwIfAborted(signal)
                  continue
                }

                throw new Error(`Copilot authorization failed: ${data.error ?? "unknown_error"}`)
              }

              throw new Error(`Copilot device authorization timed out. Enter code: ${deviceData.user_code}`)
            },
          },
        ]
      },
      async loader(auth) {
        if (auth?.type !== "oauth") return {}

        const enterpriseUrl = auth.metadata?.enterpriseUrl
        const baseURL = enterpriseUrl ? `https://copilot-api.${normalizeDomain(enterpriseUrl)}` : undefined
        const token = auth.refresh || auth.access

        return {
          ...(baseURL ? { $baseURL: baseURL } : {}),
          ...(token ? { $apiKey: token } : {}),
          $authType: "bearer",
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
            $headers: {
              "x-initiator": isAgent ? "agent" : "user",
              "Openai-Intent": "conversation-edits",
              "User-Agent": "llm-bridge",
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
