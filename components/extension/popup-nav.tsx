import type { ReactNode } from "react";
import { Blocks } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PopupNavProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leftSlot?: ReactNode;
  showManageProvidersButton?: boolean;
  onManageProviders?: () => void;
}

export function PopupNav({
  title,
  subtitle,
  leftSlot,
  showManageProvidersButton = false,
  onManageProviders,
}: PopupNavProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <div className="flex size-6 items-center justify-center empty:hidden">
        {leftSlot}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {title}
        {subtitle}
      </div>

      <div className="flex size-6 items-center justify-center">
        {showManageProvidersButton ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onManageProviders}
                className="flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Manage providers"
              >
                <Blocks className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Manage providers</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
