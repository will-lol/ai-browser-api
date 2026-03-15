import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(workspaceRoot, "packages/extension");
const extensionSrc = path.resolve(extensionRoot, "src");

const workspacePackageAliases = {
  "@llm-bridge/bridge-codecs": path.resolve(
    workspaceRoot,
    "packages/bridge-codecs/src/index.ts",
  ),
  "@llm-bridge/client": path.resolve(
    workspaceRoot,
    "packages/client/src/index.ts",
  ),
  "@llm-bridge/client-react": path.resolve(
    workspaceRoot,
    "packages/client-react/src/index.ts",
  ),
  "@llm-bridge/contracts": path.resolve(
    workspaceRoot,
    "packages/contracts/src/index.ts",
  ),
  "@llm-bridge/effect-utils": path.resolve(
    workspaceRoot,
    "packages/effect-utils/src/index.ts",
  ),
  "@llm-bridge/reactive-core": path.resolve(
    workspaceRoot,
    "packages/reactive-core/src/index.tsx",
  ),
  "@llm-bridge/runtime-core": path.resolve(
    workspaceRoot,
    "packages/runtime-core/src/index.ts",
  ),
};

export default defineConfig({
  resolve: {
    alias: [
      ...Object.entries(workspacePackageAliases).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      {
        find: /^@\//,
        replacement: `${extensionSrc}/`,
      },
      {
        find: /^~\//,
        replacement: `${extensionSrc}/`,
      },
      {
        find: /^@@\//,
        replacement: `${extensionRoot}/`,
      },
      {
        find: /^~~\//,
        replacement: `${extensionRoot}/`,
      },
    ],
  },
  test: {
    environment: "node",
    include: ["packages/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/dist/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/node_modules/**",
    ],
  },
});
