import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const modelAdapterPath = path.resolve(clientDir, "model-adapter.ts");

describe("client bridge codec boundaries", () => {
  it("consumes shared bridge codecs instead of local protocol translators", () => {
    const source = readFileSync(modelAdapterPath, "utf8");

    assert.equal(source.includes("@llm-bridge/bridge-codecs"), true);
    assert.equal(source.includes("function encodeCallOptions("), false);
    assert.equal(source.includes("function decodeGenerateResponse("), false);
    assert.equal(source.includes("function decodeStreamPart("), false);
  });
});
