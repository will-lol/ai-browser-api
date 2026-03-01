import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import {
  RouterProvider,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router"
import { Toaster } from "sonner"
import { ExtensionQueryProvider } from "@/components/extension/extension-query-provider"
import { routeTree } from "./routeTree.gen"
import "@/styles/globals.css"

const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ExtensionQueryProvider persist>
      <RouterProvider router={router} />
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
