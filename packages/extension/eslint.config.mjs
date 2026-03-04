import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const autoImportsModule = await import("./.wxt/eslint-auto-imports.mjs").catch(() => null);
const autoImports = autoImportsModule?.default ?? {};

export default defineConfig(
  {
    ignores: ["**/node_modules/**", "**/.wxt/**", "**/.output/**", "**/dist/**", "**/coverage/**"],
  },
  {
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
  eslint.configs.recommended,
  tseslint.configs.recommended,
  autoImports,
);
