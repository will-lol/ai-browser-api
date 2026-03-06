import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const runtimeAppDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(runtimeAppDir, "..", "runtime");
const runtimeAdaptersPath = path.resolve(runtimeAppDir, "runtime-adapters.ts");
const authFlowManagerPath = path.resolve(runtimeDir, "auth-flow-manager.ts");
const mutationServicePath = path.resolve(runtimeDir, "mutation-service.ts");
const modelServicePath = path.resolve(runtimeDir, "service.ts");

describe("runtime ownership boundaries", () => {
  it("keeps runtime-adapters independent from deleted wrapper modules", () => {
    const source = readFileSync(runtimeAdaptersPath, "utf8");

    assert.equal(source.includes("@/lib/runtime/mutation-service"), false);
    assert.equal(source.includes("@/lib/runtime/service"), false);
    assert.equal(existsSync(mutationServicePath), false);
    assert.equal(existsSync(modelServicePath), false);
  });

  it("consumes shared bridge codecs instead of local protocol translators", () => {
    const source = readFileSync(runtimeAdaptersPath, "utf8");

    assert.equal(source.includes("@llm-bridge/bridge-codecs"), true);
    assert.equal(source.includes("function decodeCallOptions("), false);
    assert.equal(source.includes("function toGenerateResponse("), false);
    assert.equal(source.includes("function mapStreamPart("), false);
  });

  it("keeps auth-flow manager free of catalog refresh side-effects", () => {
    const source = readFileSync(authFlowManagerPath, "utf8");
    assert.equal(source.includes("refreshProviderCatalogForProvider"), false);
  });
});
