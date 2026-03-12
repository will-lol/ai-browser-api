import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const clientReactDir = path.dirname(fileURLToPath(import.meta.url));
const clientReactIndexPath = path.resolve(clientReactDir, "index.ts");

describe("client-react public API", () => {
  it("exports hooks and provider without exposing atoms", () => {
    const source = readFileSync(clientReactIndexPath, "utf8");

    assert.equal(source.includes("BridgeProvider"), true);
    assert.equal(source.includes("useChat"), true);
    assert.equal(source.includes("useBridgeModels"), true);
    assert.equal(source.includes("useBridgeChatTransport"), false);
    assert.equal(source.includes("Atom"), false);
  });
});
