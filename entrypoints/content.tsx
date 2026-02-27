import { mountPermissionOverlay } from "@/entrypoints/content/mount-permission-overlay"
import { setupPermissionDebugBridge } from "@/entrypoints/content/permission-debug-bridge"
import "@/styles/globals.css"
import "sonner/dist/styles.css"
import { defineContentScript } from "wxt/utils/define-content-script"

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",
  async main(ctx) {
    setupPermissionDebugBridge()
    await mountPermissionOverlay(ctx)
  },
})
