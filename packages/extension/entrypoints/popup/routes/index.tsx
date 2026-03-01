import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PopupNav } from "@/components/extension/popup-nav";
import { SitePermissionsView } from "@/components/extension/site-permissions-view";
import { useActiveTab } from "@/hooks/use-active-tab";

export const Route = createFileRoute("/")({
  staticData: {
    title: "Model permissions",
    showManageProvidersButton: true,
  },
  component: SitePermissionsRoute,
});

function SitePermissionsRoute() {
  const navigate = useNavigate({ from: "/" });
  const { title, showManageProvidersButton } = Route.options.staticData;
  const { origin: activeOrigin, isPending: activeTabPending } = useActiveTab();
  const headerTitle = activeOrigin != null ? `${activeOrigin}` : title;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-none border border-border bg-background font-sans">
      <PopupNav
        title={
          <span
            className="truncate text-[13px] font-semibold text-foreground"
            title={headerTitle}
          >
            {headerTitle}
          </span>
        }
        showManageProvidersButton={showManageProvidersButton}
        onManageProviders={() => {
          void navigate({ to: "/providers" });
        }}
      />
      <SitePermissionsView
        origin={activeOrigin}
        originPending={activeTabPending}
      />
    </div>
  );
}
