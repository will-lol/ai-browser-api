import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { copilotAuthPlugin } from "@/lib/runtime/plugins/copilot";

describe("copilot loader transport", () => {
  it("returns github.com copilot bearer transport with default base url", async () => {
    const loader = copilotAuthPlugin.hooks.auth?.loader;
    assert.ok(loader);

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
    );

    assert.equal(output?.transport?.authType, "bearer");
    assert.equal(output?.transport?.apiKey, "access-token");
    assert.equal(output?.transport?.baseURL, "https://api.githubcopilot.com");
  });

  it("returns enterprise copilot bearer transport for enterprise metadata", async () => {
    const loader = copilotAuthPlugin.hooks.auth?.loader;
    assert.ok(loader);

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
    );

    assert.equal(output?.transport?.authType, "bearer");
    assert.equal(output?.transport?.apiKey, "enterprise-access-token");
    assert.equal(
      output?.transport?.baseURL,
      "https://copilot-api.company.ghe.com",
    );
  });
});
