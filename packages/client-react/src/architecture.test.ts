import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const clientReactDir = path.dirname(fileURLToPath(import.meta.url));
const clientReactPackagePath = path.resolve(clientReactDir, "..", "package.json");
const clientReactFiles = readdirSync(clientReactDir)
  .filter(
    (file) =>
      (file.endsWith(".ts") || file.endsWith(".tsx")) &&
      file.includes(".test.") === false,
  )
  .map((file) => path.resolve(clientReactDir, file));

describe("client-react architecture", () => {
  it("does not import extension, admin, or reactive engine code directly", () => {
    for (const file of clientReactFiles) {
      const source = readFileSync(file, "utf8");

      assert.equal(source.includes("@llm-bridge/extension"), false, file);
      assert.equal(source.includes("@llm-bridge/contracts"), false, file);
      assert.equal(source.includes("@effect-atom/atom-react"), false, file);
      assert.equal(source.includes("@/app/"), false, file);
      assert.equal(source.includes("@/background/"), false, file);
      assert.equal(source.includes("@/popup/"), false, file);
      assert.equal(source.includes("@/content/"), false, file);
    }
  });

  it("depends on the public client, AI SDK React, and reactive core only", () => {
    const packageJson = JSON.parse(readFileSync(clientReactPackagePath, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    assert.equal(
      "@llm-bridge/client" in (packageJson.dependencies ?? {}),
      true,
    );
    assert.equal(
      "@llm-bridge/reactive-core" in (packageJson.dependencies ?? {}),
      true,
    );
    assert.equal(
      "@ai-sdk/react" in (packageJson.dependencies ?? {}),
      true,
    );
    assert.equal(
      "@llm-bridge/contracts" in (packageJson.dependencies ?? {}),
      false,
    );
    assert.equal(
      "@effect-atom/atom-react" in (packageJson.dependencies ?? {}),
      false,
    );
  });
});
