import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  __copilotAuthInternals,
  copilotAuthPlugin,
} from "@/lib/runtime/plugins/copilot"

describe("copilot request inspection", () => {
  it("classifies legacy messages for agent and vision usage", () => {
    const result = __copilotAuthInternals.inspectCopilotRequest({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: "https://example.test/image.png",
              },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "done",
            },
          ],
        },
      ],
    })

    assert.deepEqual(result, {
      isAgent: true,
      isVision: true,
    })
  })

  it("classifies responses-style input for agent and vision usage", () => {
    const result = __copilotAuthInternals.inspectCopilotRequest({
      input: [
        {
          role: "user",
          type: "message",
          content: [{ type: "input_text", text: "hi" }],
        },
        {
          role: "assistant",
          type: "reasoning",
          content: [{ type: "input_image", image_url: "https://example.test/1.png" }],
        },
      ],
    })

    assert.deepEqual(result, {
      isAgent: true,
      isVision: true,
    })
  })
})

describe("copilot device flow helpers", () => {
  it("builds verification url with user_code prefill", () => {
    const url = __copilotAuthInternals.buildVerificationUrl({
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-1234",
    })

    const parsed = new URL(url)
    assert.equal(parsed.origin, "https://github.com")
    assert.equal(parsed.pathname, "/login/device")
    assert.equal(parsed.searchParams.get("user_code"), "ABCD-1234")
  })

  it("detects when copilot access should be refreshed", () => {
    const now = Date.now()

    assert.equal(
      __copilotAuthInternals.shouldRefreshCopilotAccessToken({
        access: "access-token",
        expiresAt: now + 120_000,
        now,
      }),
      false,
    )

    assert.equal(
      __copilotAuthInternals.shouldRefreshCopilotAccessToken({
        access: "access-token",
        expiresAt: now + 10_000,
        now,
      }),
      true,
    )

    assert.equal(
      __copilotAuthInternals.shouldRefreshCopilotAccessToken({
        access: "",
        expiresAt: now + 120_000,
        now,
      }),
      true,
    )
  })
})

describe("copilot loader transport", () => {
  it("returns github.com copilot bearer transport with default base url", async () => {
    const loader = copilotAuthPlugin.hooks.auth?.loader
    assert.ok(loader)

    const output = await loader(
      {
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        expiresAt: Date.now() + 5 * 60_000,
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        metadata: {
          authMode: "copilot_oauth",
        },
      },
      {
        id: "github-copilot",
        name: "GitHub Copilot",
        source: "models.dev",
        env: ["GITHUB_TOKEN"],
        connected: true,
        options: {},
      },
      {
        providerID: "github-copilot",
        provider: {
          id: "github-copilot",
          name: "GitHub Copilot",
          source: "models.dev",
          env: ["GITHUB_TOKEN"],
          connected: true,
          options: {},
        },
      },
    )

    assert.equal(output?.transport?.authType, "bearer")
    assert.equal(output?.transport?.apiKey, "access-token")
    assert.equal(output?.transport?.baseURL, "https://api.githubcopilot.com")
  })

  it("returns enterprise copilot bearer transport for enterprise metadata", async () => {
    const loader = copilotAuthPlugin.hooks.auth?.loader
    assert.ok(loader)

    const output = await loader(
      {
        type: "oauth",
        access: "enterprise-access-token",
        refresh: "enterprise-refresh-token",
        expiresAt: Date.now() + 5 * 60_000,
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        metadata: {
          authMode: "copilot_oauth",
          enterpriseUrl: "https://company.ghe.com",
        },
      },
      {
        id: "github-copilot",
        name: "GitHub Copilot",
        source: "models.dev",
        env: ["GITHUB_TOKEN"],
        connected: true,
        options: {},
      },
      {
        providerID: "github-copilot",
        provider: {
          id: "github-copilot",
          name: "GitHub Copilot",
          source: "models.dev",
          env: ["GITHUB_TOKEN"],
          connected: true,
          options: {},
        },
      },
    )

    assert.equal(output?.transport?.authType, "bearer")
    assert.equal(output?.transport?.apiKey, "enterprise-access-token")
    assert.equal(output?.transport?.baseURL, "https://copilot-api.company.ghe.com")
  })
})
