"use client"

import { useExtension } from "@/lib/extension-store"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import type { PermissionStatus } from "@/lib/mock-data"
import { getProviderLabel } from "@/lib/provider-labels"

interface ModelRowProps {
  modelId: string
  modelName: string
  provider: string
  capabilities: string[]
  permission: PermissionStatus
  disabled?: boolean
}

export function ModelRow({
  modelId,
  modelName,
  provider,
  capabilities,
  permission,
  disabled = false,
}: ModelRowProps) {
  const { updatePermission } = useExtension()

  const isAllowed = permission === "allowed"

  return (
    <label
      htmlFor={`model-switch-${modelId}`}
      className={`flex items-center gap-2.5 border-b border-border px-3 py-2 transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:bg-secondary/50"
      }`}
    >
      {/* Model info */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-foreground font-mono">
          {modelName}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            {getProviderLabel(provider)}
          </span>
          {capabilities.map((cap) => (
            <Badge
              key={cap}
              variant="outline"
              className="h-3.5 rounded px-1 text-[9px] font-normal text-muted-foreground border-border"
            >
              {cap}
            </Badge>
          ))}
        </div>
      </div>

      {/* Switch */}
      <Switch
        id={`model-switch-${modelId}`}
        checked={isAllowed}
        onCheckedChange={(checked) =>
          updatePermission(modelId, checked ? "allowed" : "denied")
        }
        disabled={disabled}
        aria-label={`${isAllowed ? "Revoke" : "Grant"} access to ${modelName}`}
      />
    </label>
  )
}
