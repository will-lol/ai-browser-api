import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const runtimeAppDir = path.dirname(fileURLToPath(import.meta.url));
const adaptersPath = path.resolve(runtimeAppDir, "runtime-adapters.ts");
const handlersPath = path.resolve(runtimeAppDir, "runtime-rpc-handlers.ts");
const runtimeDir = path.resolve(runtimeAppDir, "..", "runtime");

describe("runtime app architecture", () => {
  it("binds a single RuntimeEnvironment instead of repository/service layers", () => {
    const source = readFileSync(adaptersPath, "utf8");

    assert.equal(source.includes("RuntimeEnvironment"), true);
    assert.equal(source.includes("AuthRepository"), false);
    assert.equal(source.includes("PermissionService"), false);
  });

  it("implements one canonical RPC handler set", () => {
    const source = readFileSync(handlersPath, "utf8");

    assert.equal(source.includes("RuntimeRpcGroup.of"), true);
    assert.equal(source.includes("RuntimePublicRpcGroup.of"), false);
    assert.equal(source.includes("RuntimeAdminRpcGroup.of"), false);
  });

  it("does not use zod or adapter auth parse/serialize hooks in runtime sources", () => {
    const zodImports = [`from "zo${"d"}"`, `from 'zo${"d"}'`];
    const removedHooks = [`parse${"StoredAuth"}`, `serialize${"Auth"}`];
    const files = [
      path.resolve(runtimeDir, "adapters", "index.ts"),
      path.resolve(runtimeDir, "adapters", "generic-factory.ts"),
      path.resolve(runtimeDir, "adapters", "openai.ts"),
      path.resolve(runtimeDir, "adapters", "google.ts"),
      path.resolve(runtimeDir, "adapters", "github-copilot.ts"),
      path.resolve(runtimeDir, "provider-auth.ts"),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const marker of zodImports) {
        assert.equal(source.includes(marker), false, file);
      }
      for (const marker of removedHooks) {
        assert.equal(source.includes(marker), false, file);
      }
    }
  });
});
