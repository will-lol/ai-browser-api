import { defineConfig } from "wxt";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  srcDir: "src",
  imports: {
    presets: ["react"],
    dirsScanOptions: {
      filePatterns: ["*.{ts,js,mjs,cjs,mts,cts,jsx,tsx}"],
    },
    eslintrc: {
      enabled: 9,
    },
  },
  manifest: {
    name: "LLM Bridge",
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuYp7++8TzvrW13EfJNznAVYkJMirsIIW3u1v1bfNOKVyry1bauoWb3PozbVqrdOefaiFo0RZvi8B9OSd4jq1j5QPkkQfWY9kUr2i4MrTv3mvH8yYQUePUD+BXaMBqWXjYCoGtdjJRP9xNBlGRjB30J7Q8ft0cv/2E2z+ui0sOWU8U+T5EiHDp8vdChumFY2Laot7mGGs4UFKtmO84c0B3AecJE4r2f29Hkf84TN/FSDfXI04ICwRabQgS320aQXebFOHhEJ6YqyFzoYkSA7XrEWfyZUF+KFYNly1XK3fAUpP1nDwRk9/M4cYTEixROu34tFPRi3apsBSmHsW8CKL6QIDAQAB",
    description:
      "Browser AI gateway with provider plugins, permissions, and website bridge APIs.",
    version: "0.1.0",
    permissions: [
      "storage",
      "activeTab",
      "scripting",
      "identity",
      "alarms",
      "webRequest",
    ],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "LLM Bridge",
    },
  },
  vite: () => ({
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "./src/entrypoints/popup/routes",
        generatedRouteTree: "./src/entrypoints/popup/routeTree.gen.ts",
      }),
      react(),
    ],
  }),
});
