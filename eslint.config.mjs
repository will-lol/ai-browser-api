import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const repoRootDir = path.dirname(fileURLToPath(import.meta.url));
const autoImportsModule =
  await import("./packages/extension/.wxt/eslint-auto-imports.mjs").catch(
    () => null,
  );
const autoImports = autoImportsModule?.default ?? {};

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/.wxt/**",
      "**/.output/**",
      "**/dist/**",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      "packages/client/src/**/*.{ts,tsx,mts,cts}",
      "packages/client-react/src/**/*.{ts,tsx,mts,cts}",
      "packages/contracts/src/**/*.{ts,tsx,mts,cts}",
      "packages/reactive-core/src/**/*.{ts,tsx,mts,cts}",
      "packages/runtime-core/src/**/*.{ts,tsx,mts,cts}",
      "packages/example-app/src/**/*.{ts,tsx,mts,cts}",
      "packages/extension/src/**/*.{ts,tsx,mts,cts}",
      "packages/extension/scripts/**/*.ts",
      "packages/extension/wxt.config.ts",
      "packages/extension/web-ext.config.ts",
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: repoRootDir,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: [
      "packages/client-react/**/*.{js,jsx,ts,tsx}",
      "packages/reactive-core/**/*.{js,jsx,ts,tsx}",
      "packages/extension/**/*.{js,jsx,ts,tsx}",
      "packages/example-app/**/*.{js,jsx,ts,tsx}",
    ],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    files: ["packages/client/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "@effect-atom/*", "@effect/experimental*"],
              message:
                "@llm-bridge/client must remain framework-agnostic and must not depend on React or effect-atom.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/client-react/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@llm-bridge/extension",
                "@llm-bridge/contracts",
                "@llm-bridge/runtime-core",
                "@llm-bridge/bridge-codecs",
                "@/app/*",
                "@/background/*",
                "@/popup/*",
                "@/content/*",
              ],
              message:
                "@llm-bridge/client-react may only depend on the public client package and the private reactive core.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/reactive-core/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@llm-bridge/client",
                "@llm-bridge/client-react",
                "@llm-bridge/extension",
                "@llm-bridge/contracts",
                "@llm-bridge/runtime-core",
                "@llm-bridge/bridge-codecs",
                "@/app/*",
                "@/background/*",
                "@/popup/*",
                "@/content/*",
              ],
              message:
                "@llm-bridge/reactive-core must remain generic and may not depend on product-specific packages.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/extension/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@llm-bridge/*/src/*",
                "../client/src/*",
                "../../client/src/*",
                "../../../client/src/*",
                "../../../../client/src/*",
                "@llm-bridge/client-react",
              ],
              message:
                "Extension code must not import internal src files from other workspace packages or the public client-react package.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "packages/extension/src/popup/**/*.{js,jsx,ts,tsx}",
      "packages/extension/src/entrypoints/popup/**/*.{js,jsx,ts,tsx}",
      "packages/extension/src/entrypoints/connect/**/*.{js,jsx,ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@llm-bridge/*/src/*",
                "../client/src/*",
                "../../client/src/*",
                "../../../client/src/*",
                "../../../../client/src/*",
              ],
              message:
                "Do not import internal src files from other workspace packages.",
            },
            {
              group: ["@/background/*", "@/content/*"],
              message: "Popup surfaces may only depend on app and shared modules.",
            },
            {
              group: ["@/background/storage/*", "@/background/security/*"],
              message:
                "Only background modules may access storage and security implementation details.",
            },
            {
              group: ["@llm-bridge/runtime-core"],
              message:
                "Popup surfaces must not import runtime-core wiring directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "packages/extension/src/content/**/*.{js,jsx,ts,tsx}",
      "packages/extension/src/entrypoints/content/**/*.{js,jsx,ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@llm-bridge/*/src/*",
                "../client/src/*",
                "../../client/src/*",
                "../../../client/src/*",
                "../../../../client/src/*",
              ],
              message:
                "Do not import internal src files from other workspace packages.",
            },
            {
              group: ["@/background/*", "@/popup/*"],
              message:
                "Content surfaces may only depend on app, content, and shared modules.",
            },
            {
              group: ["@/background/storage/*", "@/background/security/*"],
              message:
                "Only background modules may access storage and security implementation details.",
            },
            {
              group: ["@llm-bridge/runtime-core"],
              message:
                "Content surfaces must not import runtime-core wiring directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/extension/src/app/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@llm-bridge/*/src/*",
                "../client/src/*",
                "../../client/src/*",
                "../../../client/src/*",
                "../../../../client/src/*",
              ],
              message:
                "Do not import internal src files from other workspace packages.",
            },
            {
              group: ["@/background/*", "@/popup/*", "@/content/*"],
              message:
                "App modules may only depend on app and shared modules.",
            },
            {
              group: ["@/background/storage/*", "@/background/security/*"],
              message:
                "Only background modules may access storage and security implementation details.",
            },
            {
              group: ["@llm-bridge/runtime-core"],
              message:
                "App modules must not import runtime-core wiring directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/extension/src/shared/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@llm-bridge/*/src/*",
                "../client/src/*",
                "../../client/src/*",
                "../../../client/src/*",
                "../../../../client/src/*",
              ],
              message:
                "Do not import internal src files from other workspace packages.",
            },
            {
              group: ["@/app/*", "@/background/*", "@/popup/*", "@/content/*"],
              message:
                "Shared modules must remain generic and not depend on extension surfaces.",
            },
            {
              group: ["@/background/storage/*", "@/background/security/*"],
              message:
                "Only background modules may access storage and security implementation details.",
            },
            {
              group: ["@llm-bridge/runtime-core"],
              message:
                "Shared modules must not import runtime-core wiring directly.",
            },
          ],
        },
      ],
    },
  },
  autoImports,
);
