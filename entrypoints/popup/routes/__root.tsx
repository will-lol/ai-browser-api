"use client"

import { Outlet, createRootRoute } from "@tanstack/react-router"

export const Route = createRootRoute({
  staticData: {
    title: "LLM Bridge",
  },
  component: RootRouteComponent,
})

function RootRouteComponent() {
  return (
    <div className="h-[500px] w-[340px] overflow-hidden bg-background font-sans">
      <Outlet />
    </div>
  )
}
