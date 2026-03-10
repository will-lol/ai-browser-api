import { mountPermissionOverlay } from "@/content/overlay/mount-permission-overlay";
import { setupPageApiBridge } from "@/content/bridge/page-api-bridge";
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
