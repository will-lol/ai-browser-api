import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui-components/react/switch";

import { cn } from "@/shared/utils";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-4 w-7 shrink-0 items-center border border-border/70 bg-input/80 shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[checked]:border-success/55 data-[checked]:bg-success data-[unchecked]:border-border/70 data-[unchecked]:bg-input/80 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={
          "pointer-events-none block size-3.5 border border-border/70 bg-background ring-0 transition-transform data-[checked]:translate-x-[calc(100%-2px)] data-[unchecked]:translate-x-0"
        }
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
