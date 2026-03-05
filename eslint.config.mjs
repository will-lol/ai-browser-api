import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const autoImportsModule = await import("./packages/extension/.wxt/eslint-auto-imports.mjs").catch(() => null);
const autoImports = autoImportsModule?.default ?? {};

export default defineConfig(
  {
    ignores: ["**/node_modules/**", "**/.wxt/**", "**/.output/**", "**/dist/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
    files: ["packages/extension/**/*.{js,jsx,ts,tsx}", "packages/example-app/**/*.{js,jsx,ts,tsx}"],
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
              ],
              message: "Do not import internal src files from other workspace packages.",
            },
          ],
        },
      ],
    },
  },
  autoImports,
);
