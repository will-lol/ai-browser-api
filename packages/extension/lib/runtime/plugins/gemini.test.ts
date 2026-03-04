import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { RuntimeAdapterValidationState } from "@/lib/runtime/plugin-manager"
import { geminiOAuthPlugin, resolveGeminiProjectContext } from "@/lib/runtime/plugins/gemini"

describe("resolveGeminiProjectContext", () => {
  it("uses configured project without loading managed project", async () => {
    let loadCalls = 0
    let onboardCalls = 0

    const result = await resolveGeminiProjectContext(
      "access-token",
      {
        projectId: "configured-project",
        managedProjectId: "managed-project",
      },
      {
        loadCodeAssist: async () => {
          loadCalls += 1
          return null
        },
        onboardCodeAssist: async () => {
          onboardCalls += 1
          return undefined
        },
      },
    )

    assert.deepEqual(result, {
      projectId: "configured-project",
      managedProjectId: "managed-project",
    })
    assert.equal(loadCalls, 0)
    assert.equal(onboardCalls, 0)
  })

  it("discovers managed project from loadCodeAssist", async () => {
    let onboardCalls = 0

    const result = await resolveGeminiProjectContext(
      "access-token",
      {},
      {
        loadCodeAssist: async () => ({
          cloudaicompanionProject: { id: "managed-project-123" },
        }),
        onboardCodeAssist: async () => {
          onboardCalls += 1
          return undefined
        },
      },
    )

    assert.deepEqual(result, {
      projectId: "managed-project-123",
      managedProjectId: "managed-project-123",
    })
    assert.equal(onboardCalls, 0)
  })

  it("runs onboarding flow when no project is available", async () => {
    let onboardTier: string | undefined
    let onboardProjectId: string | undefined

    const result = await resolveGeminiProjectContext(
      "access-token",
      {},
      {
        loadCodeAssist: async () => ({
          allowedTiers: [{ id: "free-tier" }],
        }),
        onboardCodeAssist: async (_token, tierId, projectId) => {
          onboardTier = tierId
          onboardProjectId = projectId
          return "managed-project-456"
        },
      },
    )

    assert.equal(onboardTier, "free-tier")
    assert.equal(onboardProjectId, undefined)
    assert.deepEqual(result, {
      projectId: "managed-project-456",
      managedProjectId: "managed-project-456",
    })
  })

  it("fails with actionable error when project cannot be resolved", async () => {
    await assert.rejects(
      () =>
        resolveGeminiProjectContext(
          "access-token",
          {},
          {
            loadCodeAssist: async () => ({
              currentTier: { id: "standard-tier" },
              ineligibleTiers: [
                {
                  reasonMessage: "Project onboarding is disabled for this account.",
                },
              ],
            }),
            onboardCodeAssist: async () => undefined,
          },
        ),
      /Google Gemini requires a Google Cloud project/,
    )
  })
})

describe("gemini adapter hooks", () => {
  it("loader returns structured transport state for oauth auth", async () => {
    const loader = geminiOAuthPlugin.hooks.auth?.loader
    assert.ok(loader)

    const output = await loader(
      {
        type: "oauth",
        access: "oauth-access",
        refresh: "oauth-refresh",
        expiresAt: Date.now() + 5 * 60_000,
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        metadata: {
          authMode: "gemini_oauth",
          projectId: "configured-project",
        },
      },
      {
        id: "google",
        name: "Google",
        source: "models.dev",
        env: ["GOOGLE_API_KEY"],
        connected: true,
        options: {},
      },
      {
        providerID: "google",
        provider: {
          id: "google",
          name: "Google",
          source: "models.dev",
          env: ["GOOGLE_API_KEY"],
          connected: true,
          options: {},
        },
      },
    )

    assert.deepEqual(output?.requestOptions ?? {}, {})
    assert.equal(output?.transport?.authType, "bearer")
    assert.equal(output?.transport?.apiKey, "oauth-access")
    assert.equal(
      (output?.transport?.metadata as Record<string, unknown>)?.geminiProjectId,
      "configured-project",
    )
  })

  it("validate fails when gemini project resolution produced an error", async () => {
    const validate = geminiOAuthPlugin.hooks.adapter?.validate
    assert.ok(validate)

    const context = {
      providerID: "google",
      modelID: "gemini-2.5-pro",
      origin: "https://example.test",
      sessionID: "session-1",
      requestID: "request-1",
      auth: {
        type: "oauth",
        access: "oauth-access",
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        metadata: {
          authMode: "gemini_oauth",
        },
      },
      provider: {
        id: "google",
        name: "Google",
        source: "models.dev",
        env: ["GOOGLE_API_KEY"],
        connected: true,
        options: {},
      },
      model: {
        id: "gemini-2.5-pro",
        providerID: "google",
        name: "Gemini 2.5 Pro",
        status: "active",
        api: {
          id: "gemini-2.5-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
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
          context: 1,
          output: 1,
        },
        options: {},
        headers: {},
        capabilities: {
          temperature: true,
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
      },
    }

    const state: RuntimeAdapterValidationState = {
      factory: {
        npm: "@ai-sdk/google",
        factory: (() => {
          throw new Error("not used")
        }) as RuntimeAdapterValidationState["factory"]["factory"],
      },
      transport: {
        authType: "bearer",
        apiKey: "oauth-access",
        headers: {},
        metadata: {
          geminiProjectError: "project resolution failed",
        },
      },
      cacheKeyParts: {},
      factoryOptions: {},
    }

    await assert.rejects(
      () => validate(context as never, state),
      /project resolution failed/,
    )
  })
})
