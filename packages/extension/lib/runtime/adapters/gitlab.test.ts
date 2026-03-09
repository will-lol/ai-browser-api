import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gitlabAdapter,
  loadGitLabAuthState,
} from "@/lib/runtime/adapters/gitlab";

describe("gitlabAdapter.auth.parseStoredAuth", () => {
  it("preserves method-aware PAT records", () => {
    const parsed = gitlabAdapter.auth.parseStoredAuth({
      type: "api",
      key: "glpat-legacy",
      methodID: "pat",
      methodType: "pat",
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() - 1_000,
      metadata: {
        instanceUrl: "https://gitlab.example.com",
      },
    });

    assert.equal(parsed?.methodID, "pat");
    assert.equal(parsed?.methodType, "pat");
    assert.deepEqual(parsed?.metadata, {
      instanceUrl: "https://gitlab.example.com",
    });
  });

  it("preserves method-aware oauth records", () => {
    const parsed = gitlabAdapter.auth.parseStoredAuth({
      type: "oauth",
      access: "oauth-access",
      refresh: "oauth-refresh",
      expiresAt: Date.now() + 60_000,
      methodID: "oauth",
      methodType: "oauth",
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() - 1_000,
      metadata: {
        instanceUrl: "https://gitlab.example.com",
      },
    });

    assert.equal(parsed?.methodID, "oauth");
    assert.equal(parsed?.methodType, "oauth");
    assert.deepEqual(parsed?.metadata, {
      instanceUrl: "https://gitlab.example.com",
    });
  });
});

describe("loadGitLabAuthState", () => {
  it("uses the normalized instance url for PAT transport", async () => {
    const output = await loadGitLabAuthState({
      providerID: "gitlab",
      provider: {
        id: "gitlab",
        name: "GitLab",
        source: "models.dev",
        env: ["GITLAB_TOKEN"],
        connected: true,
        options: {},
      },
      auth: {
        type: "api",
        key: "glpat-current",
        methodID: "pat",
        methodType: "pat",
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
        metadata: {
          instanceUrl: "https://gitlab.example.com",
        },
      },
    });

    assert.equal(output.transport.baseURL, "https://gitlab.example.com");
    assert.equal(output.transport.apiKey, "glpat-current");
    assert.equal(output.transport.authType, "bearer");
  });
});
