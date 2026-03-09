import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  githubCopilotAdapter,
  loadCopilotOAuthState,
} from "@/lib/runtime/adapters/github-copilot";

describe("loadCopilotOAuthState", () => {
  it("returns github.com copilot bearer transport with default base url", async () => {
    const output = await loadCopilotOAuthState({
      providerID: "github-copilot",
      provider: {
        id: "github-copilot",
        name: "GitHub Copilot",
        source: "models.dev",
        env: ["GITHUB_TOKEN"],
        connected: true,
        options: {},
      },
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
    });

    assert.equal(output.transport.authType, "bearer");
    assert.equal(output.transport.apiKey, "access-token");
    assert.equal(output.transport.baseURL, "https://api.githubcopilot.com");
  });

  it("returns enterprise copilot bearer transport for enterprise metadata", async () => {
    const output = await loadCopilotOAuthState({
      providerID: "github-copilot",
      provider: {
        id: "github-copilot",
        name: "GitHub Copilot",
        source: "models.dev",
        env: ["GITHUB_TOKEN"],
        connected: true,
        options: {},
      },
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
    });

    assert.equal(output.transport.authType, "bearer");
    assert.equal(output.transport.apiKey, "enterprise-access-token");
    assert.equal(
      output.transport.baseURL,
      "https://copilot-api.company.ghe.com",
    );
  });
});

describe("githubCopilotAdapter.auth.parseStoredAuth", () => {
  it("normalizes legacy oauth records into enterprise-aware metadata", () => {
    const parsed = githubCopilotAdapter.auth.parseStoredAuth({
      type: "oauth",
      access: "legacy-access",
      refresh: "legacy-refresh",
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() - 1_000,
      metadata: {
        enterpriseUrl: "https://company.ghe.com",
      },
    });

    assert.equal(parsed?.methodID, "oauth-device");
    assert.equal(parsed?.methodType, "oauth");
    assert.deepEqual(parsed?.metadata, {
      enterpriseUrl: "https://company.ghe.com",
    });
  });
});
