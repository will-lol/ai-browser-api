import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const clientFiles = readdirSync(clientDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => path.resolve(clientDir, file));

describe("client architecture", () => {
  it("keeps the public entrypoint thin and delegated", () => {
    const source = readFileSync(path.resolve(clientDir, "index.ts"), "utf8");

    assert.equal(source.includes("createBridgeClient"), true);
    assert.equal(source.includes("function createConnection("), false);
    assert.equal(source.includes("function createChatReadableStream("), false);
    assert.equal(source.includes("function makeBridgeClientApi("), false);
  });

  it("does not import zod in client sources", () => {
    const zodImports = [`from "zo${"d"}"`, `from 'zo${"d"}'`];

    for (const file of clientFiles) {
      const source = readFileSync(file, "utf8");
      for (const marker of zodImports) {
        assert.equal(source.includes(marker), false, file);
      }
    }
  });
});
