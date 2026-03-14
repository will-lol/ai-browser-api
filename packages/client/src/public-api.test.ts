import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const clientIndexPath = path.resolve(clientDir, "index.ts");

describe("client public API", () => {
  it("exports a factory-based client instead of an Effect service tag", () => {
    const source = readFileSync(clientIndexPath, "utf8");

    assert.equal(source.includes("createBridgeClient"), true);
    assert.equal(source.includes("export class BridgeClient"), false);
    assert.equal(source.includes("withBridgeClient"), false);
  });
});
