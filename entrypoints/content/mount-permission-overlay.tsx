import { createRoot, type Root } from "react-dom/client"
import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { ContentPermissionOverlay } from "@/components/extension/content-permission-overlay"

const SHADOW_UI_NAME = "llm-bridge-permission-ui"

export async function mountPermissionOverlay(ctx: ContentScriptContext) {
  let reactRoot: Root | null = null

  const ui = await createShadowRootUi(ctx, {
    name: SHADOW_UI_NAME,
    position: "overlay",
    anchor: "html",
    append: "last",
    zIndex: 2147483647,
    inheritStyles: false,
    isolateEvents: ["keydown", "keyup", "keypress"],
    onMount(container) {
      reactRoot = createRoot(container)
      reactRoot.render(<ContentPermissionOverlay />)
    },
    onRemove() {
      reactRoot?.unmount()
      reactRoot = null
    },
  })

  ui.mount()
}
