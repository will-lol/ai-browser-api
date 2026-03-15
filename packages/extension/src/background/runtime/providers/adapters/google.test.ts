import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import {
  createAuthStoreSpies,
  makeRuntimeAdapterContext,
} from "@/background/runtime/providers/adapters/adapter-test-utils";
import {
  resolveGeminiProjectContext,
  resolveGoogleExecutionState,
} from "@/background/runtime/providers/adapters/google";
import { rewriteGeminiCodeAssistRequest } from "@/background/runtime/providers/adapters/gemini-code-assist-transport";

const googleContext = makeRuntimeAdapterContext({
  providerID: "google",
  providerName: "Google",
  providerEnv: ["GOOGLE_API_KEY"],
  modelID: "gemini-2.5-pro",
  modelName: "Gemini 2.5 Pro",
  modelURL: "https://generativelanguage.googleapis.com",
  modelNpm: "@ai-sdk/google",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    code: false,
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
});

describe("resolveGeminiProjectContext", () => {
  it("uses configured project without loading managed project", async () => {
    let loadCalls = 0;
    let onboardCalls = 0;

    const result = await Effect.runPromise(
      resolveGeminiProjectContext(
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
      ),
    );

    expect(result).toEqual({
      projectId: "configured-project",
      managedProjectId: "managed-project",
    });
    expect(loadCalls).toBe(0);
    expect(onboardCalls).toBe(0);
  });

  it("discovers managed project from loadCodeAssist", async () => {
    let onboardCalls = 0;

    const result = await Effect.runPromise(
      resolveGeminiProjectContext(
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
      ),
    );

    expect(result).toEqual({
      projectId: "managed-project-123",
      managedProjectId: "managed-project-123",
    });
    expect(onboardCalls).toBe(0);
  });

  it("runs onboarding flow when no project is available", async () => {
    let onboardTier: string | undefined;
    let onboardProjectId: string | undefined;

    const result = await Effect.runPromise(
      resolveGeminiProjectContext(
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
      ),
    );

    expect(onboardTier).toBe("free-tier");
    expect(onboardProjectId).toBeUndefined();
    expect(result).toEqual({
      projectId: "managed-project-456",
      managedProjectId: "managed-project-456",
    });
  });

  it("fails with actionable error when project cannot be resolved", async () => {
    await expect(
      Effect.runPromise(
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
      ),
    ).rejects.toThrow(/Google Gemini requires a Google Cloud project/);
  });
});

describe("resolveGoogleExecutionState", () => {
  it("returns oauth execution headers including Authorization", async () => {
    const { authStore, setCalls } = createAuthStoreSpies();
    const output = await Effect.runPromise(
      resolveGoogleExecutionState({
        ...googleContext,
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
        authStore,
      }),
    );

    expect(output.kind).toBe("oauth");
    expect(output.apiKey).toBe("oauth-access");
    expect(new Headers(output.headers).get("authorization")).toBe(
      "Bearer oauth-access",
    );
    expect(output.projectId).toBe("configured-project");
    expect(setCalls).toHaveLength(0);
  });

  it("provides headers that let code-assist request rewriting proceed", async () => {
    const { authStore } = createAuthStoreSpies();
    const execution = await Effect.runPromise(
      resolveGoogleExecutionState({
        ...googleContext,
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
        authStore,
      }),
    );

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

    expect(rewritten).toBeTruthy();
    const headers = new Headers(rewritten?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer oauth-access");
  });
});
