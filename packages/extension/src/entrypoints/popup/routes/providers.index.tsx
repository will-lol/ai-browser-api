import { createFileRoute } from "@tanstack/react-router";
import { ProvidersView } from "@/popup/features/providers/providers-view";

export const Route = createFileRoute("/providers/")({
  staticData: {
    title: "Providers",
  },
  component: ProvidersIndexRoute,
});

function ProvidersIndexRoute() {
  return <ProvidersView />;
}
