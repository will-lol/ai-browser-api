import { ArrowLeft } from "lucide-react"
import { Outlet, createFileRoute, useRouter } from "@tanstack/react-router"
import { PopupNav } from "@/components/extension/popup-nav"
import { Button } from "@/components/ui/button"

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
          <Button
            onClick={() => {
              void router.history.back()
            }}
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
      />
      <Outlet />
    </div>
  )
}
