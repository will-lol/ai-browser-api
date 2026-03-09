import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveExtensionAuthMethods } from "@/lib/extension-auth-methods";

describe("extension auth method resolver", () => {
  it("keeps runtime method order while resolving adapter-backed schemas", async () => {
    const methods = await resolveExtensionAuthMethods({
      providerID: "openai",
      methodIDs: ["oauth-device", "apikey", "oauth-browser"],
    });

    assert.deepEqual(
      methods.map((method) => method.id),
      ["oauth-device", "apikey", "oauth-browser"],
    );
    assert.equal(methods[1]?.fields.length, 1);
    assert.equal(methods[1]?.fields[0]?.key, "apiKey");
  });

  it("falls back to generic npm adapters for frontend auth schemas", async () => {
    const methods = await resolveExtensionAuthMethods({
      providerID: "groq",
      methodIDs: ["apikey"],
    });

    assert.equal(methods.length, 1);
    assert.equal(methods[0]?.id, "apikey");
    assert.equal(methods[0]?.fields[0]?.key, "apiKey");
  });

  it("preserves conditional field metadata for local schema rendering", async () => {
    const methods = await resolveExtensionAuthMethods({
      providerID: "github-copilot",
      methodIDs: ["oauth-device"],
    });

    const enterpriseUrl = methods[0]?.fields.find((field) => field.key === "enterpriseUrl");

    assert.ok(enterpriseUrl);
    assert.equal(enterpriseUrl.condition?.key, "deploymentType");
    assert.equal(enterpriseUrl.condition?.equals, "enterprise");
  });
});
