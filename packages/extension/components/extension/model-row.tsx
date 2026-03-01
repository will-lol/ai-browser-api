import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import type { PermissionStatus } from "@/lib/runtime/permissions"
import { getProviderLabel } from "@/lib/provider-labels"
import { usePermissionUpdateMutation } from "@/lib/extension-query-hooks"

interface ModelRowProps {
  id: string
  name: string
  provider: string
  capabilities: string[]
  permission: PermissionStatus
  origin: string
  disabled?: boolean
}

export function ModelRow({
  id,
  name,
  provider,
  capabilities,
  permission,
  origin,
  disabled = false,
}: ModelRowProps) {
  const updatePermissionMutation = usePermissionUpdateMutation(origin)
  const isAllowed = permission === "allowed"
  const controlsDisabled = disabled || updatePermissionMutation.isPending

  return (
    <label
      htmlFor={`model-switch-${id}`}
      className={`flex items-center gap-2.5 border-b border-border px-3 py-2 transition-colors ${
        controlsDisabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:bg-secondary/50"
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-mono text-xs font-medium text-foreground">
          {name}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            {getProviderLabel(provider)}
          </span>
          {capabilities.map((capability) => (
            <Badge
              key={capability}
              variant="outline"
              className="h-3.5 rounded border-border px-1 text-[9px] font-normal text-muted-foreground"
            >
              {capability}
            </Badge>
          ))}
        </div>
      </div>

      <Switch
        id={`model-switch-${id}`}
        checked={isAllowed}
        onCheckedChange={(checked) => {
          updatePermissionMutation.mutate({
            modelId: id,
            status: checked ? "allowed" : "denied",
          })
        }}
        disabled={controlsDisabled}
        aria-label={`${isAllowed ? "Revoke" : "Grant"} access to ${name}`}
      />
    </label>
  )
}
