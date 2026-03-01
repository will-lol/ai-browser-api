import { useMemo, useState } from "react";
import { ModelRow } from "@/components/extension/model-row";
import { PendingRequestCard } from "@/components/extension/pending-request-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Blocks } from "lucide-react";
import { SearchInput } from "@/components/extension/search-input";
import { useFrozenOrder } from "@/hooks/use-frozen-order";
import { useNavigate } from "@tanstack/react-router";
import {
  useModelsQuery,
  useOriginEnabledMutation,
  useOriginStateQuery,
  usePendingRequestsQuery,
  usePermissionsQuery,
} from "@/lib/extension-query-hooks";

interface SitePermissionsViewProps {
  origin: string | null;
  originPending?: boolean;
}

export function SitePermissionsView({
  origin,
  originPending = false,
}: SitePermissionsViewProps) {
  const targetOrigin = origin ?? "";
  const hasActiveOrigin = origin != null;
  const originStateQuery = useOriginStateQuery(targetOrigin);
  const modelsQuery = useModelsQuery({
    origin: targetOrigin,
    connectedOnly: true,
  });
  const permissionsQuery = usePermissionsQuery(targetOrigin);
  const pendingRequestsQuery = usePendingRequestsQuery(targetOrigin);
  const setOriginEnabledMutation = useOriginEnabledMutation(targetOrigin);

  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const originEnabled =
    hasActiveOrigin && (originStateQuery.data?.enabled ?? true);
  const pendingRequests = pendingRequestsQuery.data ?? [];
  const allModels = modelsQuery.data ?? [];

  const permissionByModelId = useMemo(() => {
    const permissions = permissionsQuery.data ?? [];
    return new Map(
      permissions.map(
        (permission) => [permission.modelId, permission.status] as const,
      ),
    );
  }, [permissionsQuery.data]);

  const pendingModelIds = useMemo(
    () => new Set(pendingRequests.map((request) => request.modelId)),
    [pendingRequests],
  );

  const frozenOrder = useFrozenOrder(
    allModels,
    (model) => model.modelId,
    (a, b) => {
      const aPending = pendingModelIds.has(a.modelId);
      const bPending = pendingModelIds.has(b.modelId);
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;

      const aPermission = permissionByModelId.get(a.modelId) ?? "denied";
      const bPermission = permissionByModelId.get(b.modelId) ?? "denied";
      if (aPermission === "allowed" && bPermission !== "allowed") return -1;
      if (aPermission !== "allowed" && bPermission === "allowed") return 1;
      return a.modelName.localeCompare(b.modelName);
    },
  );

  const sortedModels = useMemo(() => {
    const modelsById = new Map(
      allModels.map((model) => [
        model.modelId,
        {
          ...model,
          permission: permissionByModelId.get(model.modelId) ?? "denied",
          isPending: pendingModelIds.has(model.modelId),
        },
      ]),
    );

    const ordered = frozenOrder
      .map((id) => modelsById.get(id))
      .filter((model): model is NonNullable<typeof model> => model != null);

    const withoutPending = ordered.filter((model) => !model.isPending);

    if (!search) return withoutPending;

    const query = search.toLowerCase();
    return withoutPending.filter(
      (model) =>
        model.modelName.toLowerCase().includes(query) ||
        model.provider.toLowerCase().includes(query),
    );
  }, [allModels, frozenOrder, pendingModelIds, permissionByModelId, search]);

  const hasConnectedProviders = allModels.length > 0;
  const controlsDisabled =
    originPending || !hasActiveOrigin || setOriginEnabledMutation.isPending;

  if (originPending) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
        <p className="text-xs text-muted-foreground">Loading active tab...</p>
      </div>
    );
  }

  if (!hasActiveOrigin) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
        <p className="text-xs text-muted-foreground">
          Unable to detect the active tab origin.
        </p>
      </div>
    );
  }

  if (
    originStateQuery.isError ||
    modelsQuery.isError ||
    permissionsQuery.isError ||
    pendingRequestsQuery.isError
  ) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
        <p className="text-xs text-destructive">
          Failed to load permissions data.
        </p>
      </div>
    );
  }

  if (
    originStateQuery.isPending ||
    modelsQuery.isPending ||
    permissionsQuery.isPending ||
    pendingRequestsQuery.isPending
  ) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
        <p className="text-xs text-muted-foreground">Loading models...</p>
      </div>
    );
  }

  if (!hasConnectedProviders) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10">
        <div className="flex size-12 items-center justify-center bg-secondary text-muted-foreground">
          <Blocks className="size-6" />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-sm font-medium text-foreground">
            No providers connected
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Connect a model provider to start granting websites access to AI
            models.
          </p>
        </div>
        <button
          onClick={() => {
            void navigate({ to: "/providers" });
          }}
          className="bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Connect a provider
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <label
        htmlFor="origin-enabled-switch"
        className="flex cursor-pointer items-center justify-between border-b border-border px-3 py-1.5 font-sans transition-colors hover:bg-secondary/50"
      >
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Site enabled
        </span>
        <Switch
          id="origin-enabled-switch"
          checked={originEnabled}
          disabled={controlsDisabled}
          onCheckedChange={(checked) => {
            setOriginEnabledMutation.mutate({ enabled: checked });
          }}
          aria-label="Enable extension on this site"
        />
      </label>

      <SearchInput
        ariaLabel="Search models"
        placeholder="Search models..."
        value={search}
        onChange={setSearch}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {pendingRequests.length > 0 && !search && (
            <div className="flex flex-col">
              <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-1 backdrop-blur-sm">
                <span className="text-[10px] font-medium uppercase tracking-wider text-warning">
                  Pending requests
                </span>
              </div>
              {pendingRequests.map((request) => (
                <PendingRequestCard
                  key={request.id}
                  request={request}
                  origin={targetOrigin}
                  variant="inline"
                  actionsDisabled={!originEnabled || controlsDisabled}
                />
              ))}
            </div>
          )}

          {sortedModels.length > 0 ? (
            <div className="flex flex-col">
              {!search && pendingRequests.length > 0 && (
                <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-1 backdrop-blur-sm">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    All models
                  </span>
                </div>
              )}
              {sortedModels.map((model) => (
                <ModelRow
                  key={model.modelId}
                  modelId={model.modelId}
                  modelName={model.modelName}
                  provider={model.provider}
                  capabilities={model.capabilities}
                  permission={model.permission}
                  origin={targetOrigin}
                  disabled={!originEnabled || controlsDisabled}
                />
              ))}
            </div>
          ) : search ? (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                No models matching &ldquo;{search}&rdquo;
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
