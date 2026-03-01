import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"
import { ConnectProviderWindow } from "@/components/extension/connect-provider-window"
import { ExtensionQueryProvider } from "@/components/extension/extension-query-provider"
import "@/styles/globals.css"

const params = new URLSearchParams(window.location.search)
const providerID = params.get("providerID") ?? ""

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ExtensionQueryProvider>
      {providerID
        ? (
            <ConnectProviderWindow providerID={providerID} />
          )
        : (
            <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
              <p className="text-xs text-destructive">Missing providerID query parameter.</p>
            </div>
          )}
      <Toaster
        position="top-right"
        expand={false}
        gap={8}
        visibleToasts={4}
        closeButton={false}
      />
    </ExtensionQueryProvider>
  </StrictMode>,
)
