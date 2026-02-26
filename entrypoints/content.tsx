import { mountPermissionOverlay } from "@/entrypoints/content/mount-permission-overlay"
import "@/styles/globals.css"

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",
  async main(ctx) {
    if (!("showPopover" in HTMLElement.prototype)) return
    await mountPermissionOverlay(ctx)
  },
})
