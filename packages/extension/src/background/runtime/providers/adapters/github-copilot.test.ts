import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import {
  createAuthStoreSpies,
  makeRuntimeAdapterContext,
} from "@/background/runtime/providers/adapters/adapter-test-utils";
import { resolveCopilotExecutionState } from "@/background/runtime/providers/adapters/github-copilot";

const copilotContext = makeRuntimeAdapterContext({
  providerID: "github-copilot",
  providerName: "GitHub Copilot",
  providerEnv: ["GITHUB_TOKEN"],
  modelID: "gpt-4o",
  modelName: "GPT-4o",
  modelURL: "https://api.githubcopilot.com",
  modelNpm: "@ai-sdk/github-copilot",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    code: true,
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
});

describe("resolveCopilotExecutionState", () => {
  it("returns github.com copilot bearer settings with default base url", async () => {
    const { authStore } = createAuthStoreSpies();
    const output = await Effect.runPromise(
      resolveCopilotExecutionState({
        ...copilotContext,
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
        authStore,
      }),
    );

    expect(output.apiKey).toBe("access-token");
    expect(output.baseURL).toBe("https://api.githubcopilot.com");
  });

  it("returns enterprise copilot settings for enterprise metadata", async () => {
    const { authStore } = createAuthStoreSpies();
    const output = await Effect.runPromise(
      resolveCopilotExecutionState({
        ...copilotContext,
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
        authStore,
      }),
    );

    expect(output.apiKey).toBe("enterprise-access-token");
    expect(output.baseURL).toBe("https://copilot-api.company.ghe.com");
  });
});
