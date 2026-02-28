import { resolve } from "node:path";
import { defineConfig } from "wxt";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
    description:
      "Browser AI gateway with provider plugins, permissions, and website bridge APIs.",
    version: "0.1.0",
    permissions: ["storage", "activeTab", "scripting", "identity", "alarms"],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "LLM Bridge",
    },
    web_accessible_resources: [
      {
        resources: ["llm-bridge-page-api.js"],
        matches: ["<all_urls>"],
      },
    ],
  },
  vite: () => ({
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "./entrypoints/popup/routes",
        generatedRouteTree: "./entrypoints/popup/routeTree.gen.ts",
      }),
      react(),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "."),
      },
    },
  }),
});
