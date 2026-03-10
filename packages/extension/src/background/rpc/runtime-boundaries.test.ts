import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const runtimeAppDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(runtimeAppDir, "..", "runtime");
const backgroundDir = path.resolve(runtimeAppDir, "..");
const srcDir = path.resolve(backgroundDir, "..");
const popupDir = path.resolve(srcDir, "popup");
const contentDir = path.resolve(srcDir, "content");
const popupEntrypointDir = path.resolve(srcDir, "entrypoints", "popup");
const connectEntrypointDir = path.resolve(srcDir, "entrypoints", "connect");
const contentEntrypointDir = path.resolve(srcDir, "entrypoints", "content");
const runtimeAdaptersPath = path.resolve(runtimeAppDir, "runtime-adapters.ts");
const authFlowManagerPath = path.resolve(runtimeDir, "auth-flow-manager.ts");
const mutationServicePath = path.resolve(runtimeDir, "mutation-service.ts");
const modelServicePath = path.resolve(runtimeDir, "service.ts");

function collectSourceFiles(rootDir: string): string[] {
  const entries = readdirSync(rootDir, {
    withFileTypes: true,
  });

  return entries.flatMap((entry) => {
    const nextPath = path.resolve(rootDir, entry.name);

    if (entry.isDirectory()) {
      return collectSourceFiles(nextPath);
    }

    if (
      nextPath.endsWith(".ts") ||
      nextPath.endsWith(".tsx") ||
      nextPath.endsWith(".d.ts")
    ) {
      return [nextPath];
    }

    return [];
  });
}

describe("runtime ownership boundaries", () => {
  it("keeps runtime-adapters independent from deleted wrapper modules", () => {
    const source = readFileSync(runtimeAdaptersPath, "utf8");

    assert.equal(source.includes("@/background/runtime/mutation-service"), false);
    assert.equal(source.includes("@/background/runtime/service"), false);
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

  it("keeps popup surfaces independent from background implementation imports", () => {
    const files = [
      ...collectSourceFiles(popupDir),
      ...collectSourceFiles(popupEntrypointDir),
      ...collectSourceFiles(connectEntrypointDir),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes('from "@/background/'), false, file);
      assert.equal(source.includes("from '@/background/"), false, file);
    }
  });

  it("keeps content surfaces independent from popup and background implementation imports", () => {
    const files = [
      ...collectSourceFiles(contentDir),
      ...collectSourceFiles(contentEntrypointDir),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes('from "@/popup/'), false, file);
      assert.equal(source.includes("from '@/popup/"), false, file);
      assert.equal(source.includes('from "@/background/'), false, file);
      assert.equal(source.includes("from '@/background/"), false, file);
    }
  });

  it("keeps non-background surfaces away from storage, security, and runtime-core wiring", () => {
    const files = [
      ...collectSourceFiles(popupDir),
      ...collectSourceFiles(contentDir),
      ...collectSourceFiles(popupEntrypointDir),
      ...collectSourceFiles(connectEntrypointDir),
      ...collectSourceFiles(contentEntrypointDir),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("@/background/storage/"), false, file);
      assert.equal(source.includes("@/background/security/"), false, file);
    }
  });
});
