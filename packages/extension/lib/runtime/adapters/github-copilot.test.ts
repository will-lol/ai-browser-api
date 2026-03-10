import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCopilotExecutionState } from "@/lib/runtime/adapters/github-copilot";
import type { RuntimeAdapterContext } from "@/lib/runtime/adapters/types";

function createContext(): Omit<RuntimeAdapterContext, "auth" | "authStore"> {
  return {
    providerID: "github-copilot",
    modelID: "gpt-4o",
    origin: "https://example.test",
    sessionID: "session-1",
    requestID: "request-1",
    provider: {
      id: "github-copilot",
      name: "GitHub Copilot",
      source: "models.dev",
      env: ["GITHUB_TOKEN"],
      connected: true,
      options: {},
    },
    model: {
      id: "gpt-4o",
      providerID: "github-copilot",
      name: "GPT-4o",
      status: "active",
      api: {
        id: "gpt-4o",
        url: "https://api.githubcopilot.com",
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
      limit: {
        context: 1,
        output: 1,
      },
      options: {},
      headers: {},
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
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

describe("resolveCopilotExecutionState", () => {
  it("returns github.com copilot bearer settings with default base url", async () => {
    const output = await resolveCopilotExecutionState({
      ...createContext(),
      auth: {
        type: "oauth",
        methodID: "oauth-device",
        methodType: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        expiresAt: Date.now() + 5 * 60_000,
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
      },
      authStore: {
        get: async () => undefined,
        set: async () => undefined,
        remove: async () => undefined,
      },
    });

    assert.equal(output.apiKey, "access-token");
    assert.equal(output.baseURL, "https://api.githubcopilot.com");
  });

  it("returns enterprise copilot settings for enterprise metadata", async () => {
    const output = await resolveCopilotExecutionState({
      ...createContext(),
      auth: {
        type: "oauth",
        methodID: "oauth-device",
        methodType: "oauth",
        access: "enterprise-access-token",
        refresh: "enterprise-refresh-token",
        expiresAt: Date.now() + 5 * 60_000,
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        metadata: {
          enterpriseUrl: "https://company.ghe.com",
        },
      },
      authStore: {
        get: async () => undefined,
        set: async () => undefined,
        remove: async () => undefined,
      },
    });

    assert.equal(output.apiKey, "enterprise-access-token");
    assert.equal(output.baseURL, "https://copilot-api.company.ghe.com");
  });
});
