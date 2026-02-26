import { createRoot, type Root } from "react-dom/client"
import type { ContentScriptContext } from "wxt/client"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { ContentPermissionOverlay } from "@/components/extension/content-permission-overlay"

const POPOVER_ID = "llm-bridge-popover"
const SHADOW_UI_NAME = "llm-bridge-permission-ui"

function createPopoverHost() {
  const host = document.createElement("div")
  host.id = POPOVER_ID
  host.setAttribute("popover", "manual")
  host.className = "pointer-events-none border-0 bg-transparent p-6"
  host.style.position = "fixed"
  host.style.inset = "auto 0 auto auto"
  host.style.margin = "0"
  host.style.overflow = "visible"
  return host
}

function setPopoverVisibility(popover: HTMLElement, visible: boolean) {
  if (visible) {
    try {
      popover.showPopover()
    } catch {
      // no-op: already open
    }
    return
  }

  try {
    popover.hidePopover()
  } catch {
    // no-op: already closed
  }
}

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
      const popover = createPopoverHost()
      container.append(popover)

      reactRoot = createRoot(popover)
      reactRoot.render(
        <ContentPermissionOverlay
          onVisibilityChange={(visible) => setPopoverVisibility(popover, visible)}
        />
      )
    },
    onRemove() {
      reactRoot?.unmount()
      reactRoot = null
    },
  })

  ui.mount()
}
