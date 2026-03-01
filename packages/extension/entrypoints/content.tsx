import { mountPermissionOverlay } from "@/entrypoints/content/mount-permission-overlay";
import { setupPageApiBridge } from "@/entrypoints/content/page-api-bridge";
import "@/styles/globals.css";
import "sonner/dist/styles.css";
import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",
  async main(ctx) {
    setupPageApiBridge();
    await mountPermissionOverlay(ctx);
  },
});
