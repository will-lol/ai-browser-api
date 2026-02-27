import { resolve } from "node:path"
import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: {
    eslintrc: {
      enabled: 9,
    },
  },
  manifest: {
    name: "LLM Bridge",
    description:
      "Prototype browser extension UI for model permission management.",
    version: "0.1.0",
    permissions: ["storage", "activeTab", "scripting"],
    action: {
      default_title: "LLM Bridge",
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    web_accessible_resources: [
      {
        resources: ["permission-debug-bridge.js"],
        matches: ["<all_urls>"],
      },
    ],
  },
  vite: () => ({
    resolve: {
      alias: {
        "@": resolve(__dirname, "."),
      },
    },
  }),
})
