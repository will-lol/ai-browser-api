import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const clientReactDir = path.dirname(fileURLToPath(import.meta.url));
const clientReactPackagePath = path.resolve(clientReactDir, "..", "package.json");

describe("client-react architecture", () => {
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
