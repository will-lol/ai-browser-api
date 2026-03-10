import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  googleAdapter,
  resolveGeminiProjectContext,
  resolveGoogleExecutionState,
} from "@/lib/runtime/adapters/google";
import { rewriteGeminiCodeAssistRequest } from "@/lib/runtime/adapters/gemini-code-assist-transport";
import type { RuntimeAdapterContext } from "@/lib/runtime/adapters/types";

function createContext(): Omit<RuntimeAdapterContext, "auth" | "authStore"> {
  return {
    providerID: "google",
    modelID: "gemini-2.5-pro",
    origin: "https://example.test",
    sessionID: "session-1",
    requestID: "request-1",
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
    runtime: {
      now: () => Date.now(),
    },
  };
}

describe("resolveGeminiProjectContext", () => {
  it("uses configured project without loading managed project", async () => {
    let loadCalls = 0;
    let onboardCalls = 0;

    const result = await resolveGeminiProjectContext(
      "access-token",
      {
        projectId: "configured-project",
        managedProjectId: "managed-project",
      },
      {
        loadCodeAssist: async () => {
          loadCalls += 1;
          return null;
        },
        onboardCodeAssist: async () => {
          onboardCalls += 1;
          return undefined;
        },
      },
    );

    assert.deepEqual(result, {
      projectId: "configured-project",
      managedProjectId: "managed-project",
    });
    assert.equal(loadCalls, 0);
    assert.equal(onboardCalls, 0);
  });

  it("discovers managed project from loadCodeAssist", async () => {
    let onboardCalls = 0;

    const result = await resolveGeminiProjectContext(
      "access-token",
      {},
      {
        loadCodeAssist: async () => ({
          cloudaicompanionProject: { id: "managed-project-123" },
        }),
        onboardCodeAssist: async () => {
          onboardCalls += 1;
          return undefined;
        },
      },
    );

    assert.deepEqual(result, {
      projectId: "managed-project-123",
      managedProjectId: "managed-project-123",
    });
    assert.equal(onboardCalls, 0);
  });

  it("runs onboarding flow when no project is available", async () => {
    let onboardTier: string | undefined;
    let onboardProjectId: string | undefined;

    const result = await resolveGeminiProjectContext(
      "access-token",
      {},
      {
        loadCodeAssist: async () => ({
          allowedTiers: [{ id: "free-tier" }],
        }),
        onboardCodeAssist: async (_token, tierId, projectId) => {
          onboardTier = tierId;
          onboardProjectId = projectId;
          return "managed-project-456";
        },
      },
    );

    assert.equal(onboardTier, "free-tier");
    assert.equal(onboardProjectId, undefined);
    assert.deepEqual(result, {
      projectId: "managed-project-456",
      managedProjectId: "managed-project-456",
    });
  });

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
                  reasonMessage:
                    "Project onboarding is disabled for this account.",
                },
              ],
            }),
            onboardCodeAssist: async () => undefined,
          },
        ),
      /Google Gemini requires a Google Cloud project/,
    );
  });
});

describe("resolveGoogleExecutionState", () => {
  it("returns oauth execution headers including Authorization", async () => {
    const setAuthCalls: unknown[] = [];
    const output = await resolveGoogleExecutionState({
      ...createContext(),
      auth: {
        type: "oauth",
        methodID: "oauth",
        methodType: "oauth",
        access: "oauth-access",
        refresh: "oauth-refresh",
        expiresAt: Date.now() + 5 * 60_000,
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        metadata: {
          projectId: "configured-project",
        },
      },
      authStore: {
        get: async () => undefined,
        set: async (auth) => {
          setAuthCalls.push(auth);
        },
        remove: async () => undefined,
      },
    });

    assert.equal(output.kind, "oauth");
    assert.equal(output.apiKey, "oauth-access");
    assert.equal(output.headers.Authorization, "Bearer oauth-access");
    assert.equal(output.projectId, "configured-project");
    assert.equal(setAuthCalls.length, 0);
  });

  it("provides headers that let code-assist request rewriting proceed", async () => {
    const execution = await resolveGoogleExecutionState({
      ...createContext(),
      auth: {
        type: "oauth",
        methodID: "oauth",
        methodType: "oauth",
        access: "oauth-access",
        refresh: "oauth-refresh",
        expiresAt: Date.now() + 5 * 60_000,
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        metadata: {
          projectId: "configured-project",
        },
      },
      authStore: {
        get: async () => undefined,
        set: async () => undefined,
        remove: async () => undefined,
      },
    });

    const rewritten = await rewriteGeminiCodeAssistRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
      {
        method: "POST",
        headers: execution.headers,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "hello" }],
            },
          ],
        }),
      },
      {
        projectId: execution.projectId ?? "configured-project",
      },
    );

    assert.ok(rewritten);
    const headers = new Headers(rewritten.init.headers);
    assert.equal(headers.get("authorization"), "Bearer oauth-access");
  });
});

describe("googleAdapter.auth.parseStoredAuth", () => {
  it("preserves method-aware oauth metadata", () => {
    const parsed = googleAdapter.auth.parseStoredAuth({
      type: "oauth",
      methodID: "oauth",
      methodType: "oauth",
      access: "oauth-access",
      refresh: "oauth-refresh",
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() - 1_000,
      metadata: {
        email: "dev@example.com",
        projectId: "configured-project",
        managedProjectId: "managed-project",
      },
    });

    assert.equal(parsed?.methodID, "oauth");
    assert.equal(parsed?.methodType, "oauth");
    assert.deepEqual(parsed?.metadata, {
      email: "dev@example.com",
      projectId: "configured-project",
      managedProjectId: "managed-project",
    });
  });
});
