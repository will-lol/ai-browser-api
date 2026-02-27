import autoImports from "./.wxt/eslint-auto-imports.mjs";

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["**/node_modules/**", "**/.wxt/**", "**/.output/**", "**/dist/**", "**/coverage/**"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  autoImports,
);
