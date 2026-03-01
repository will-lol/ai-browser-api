import { ArrowLeft } from "lucide-react"
import { Outlet, createFileRoute, useRouter } from "@tanstack/react-router"
import { PopupNav } from "@/components/extension/popup-nav"

export const Route = createFileRoute("/providers")({
  staticData: {
    title: "Providers",
  },
  component: ProvidersRoute,
})

function ProvidersRoute() {
  const router = useRouter()
  const { title } = Route.options.staticData

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-none border border-border bg-background font-sans [&_*]:rounded-none">
      <PopupNav
        title={<span className="text-[13px] font-semibold text-foreground">{title}</span>}
        leftSlot={(
          <button
            onClick={() => {
              void router.history.back()
            }}
            className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
      />
      <Outlet />
    </div>
  )
}
