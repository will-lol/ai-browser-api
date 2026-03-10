import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui-components/react/tooltip";

import { cn } from "@/shared/utils";

type TooltipProviderProps = Omit<
  React.ComponentProps<typeof TooltipPrimitive.Provider>,
  "delay"
> & {
  delayDuration?: number;
};

function TooltipProvider({
  delayDuration = 0,
  ...props
}: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

type TooltipTriggerProps = React.ComponentProps<
  typeof TooltipPrimitive.Trigger
> & {
  asChild?: boolean;
};

function TooltipTrigger({
  asChild = false,
  children,
  render,
  ...props
}: TooltipTriggerProps) {
  if (asChild) {
    if (!React.isValidElement(children)) {
      return null;
    }
    const renderElement = children as React.ReactElement<
      Record<string, unknown>
    >;

    return (
      <TooltipPrimitive.Trigger
        data-slot="tooltip-trigger"
        render={renderElement}
        {...props}
      />
    );
  }

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      render={render}
      {...props}
    >
      {children}
    </TooltipPrimitive.Trigger>
  );
}

type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof TooltipPrimitive.Positioner>,
    | "side"
    | "align"
    | "sideOffset"
    | "alignOffset"
    | "collisionBoundary"
    | "collisionPadding"
    | "arrowPadding"
    | "sticky"
  >;

function TooltipContent({
  className,
  side,
  align,
  sideOffset = 0,
  alignOffset,
  collisionBoundary,
  collisionPadding,
  arrowPadding,
  sticky,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionBoundary={collisionBoundary}
        collisionPadding={collisionPadding}
        arrowPadding={arrowPadding}
        sticky={sticky}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="bg-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent };
