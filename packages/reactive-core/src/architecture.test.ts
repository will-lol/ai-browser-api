import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const reactiveCoreDir = path.dirname(fileURLToPath(import.meta.url));
const reactiveCoreFiles = readdirSync(reactiveCoreDir)
  .filter(
    (file) =>
      (file.endsWith(".ts") || file.endsWith(".tsx")) &&
      file.includes(".test.") === false,
  )
  .map((file) => path.resolve(reactiveCoreDir, file));

describe("reactive-core architecture", () => {
  it("does not import product-specific packages", () => {
    for (const file of reactiveCoreFiles) {
      const source = readFileSync(file, "utf8");

      assert.equal(source.includes("@llm-bridge/client"), false, file);
      assert.equal(source.includes("@llm-bridge/client-react"), false, file);
      assert.equal(source.includes("@llm-bridge/contracts"), false, file);
      assert.equal(source.includes("@llm-bridge/runtime-core"), false, file);
      assert.equal(source.includes("@llm-bridge/runtime-events"), false, file);
      assert.equal(source.includes("@/app/"), false, file);
      assert.equal(source.includes("@/background/"), false, file);
      assert.equal(source.includes("@/popup/"), false, file);
      assert.equal(source.includes("@/content/"), false, file);
    }
  });
});
