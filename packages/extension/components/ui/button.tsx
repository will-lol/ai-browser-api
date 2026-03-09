"use client";

import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui-components/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-none font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline:
          "border border-border bg-background text-foreground hover:bg-secondary",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        successGhost:
          "text-muted-foreground hover:bg-success/10 hover:text-success",
        destructiveGhost:
          "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "px-3 py-1.5 text-xs",
        sm: "px-2 py-1 text-[11px]",
        lg: "px-4 py-2 text-xs",
        icon: "p-1",
        "icon-sm": "p-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLElement, ButtonProps>(function Button(
  {
    className,
    variant = "default",
    size = "default",
    asChild = false,
    children,
    render,
    ...props
  },
  ref,
) {
  const buttonClassName = cn(buttonVariants({ variant, size, className }));

  if (asChild) {
    if (!React.isValidElement(children)) {
      return null;
    }
    const renderElement = children as React.ReactElement<
      Record<string, unknown>
    >;

    return (
      <ButtonPrimitive
        ref={ref}
        data-slot="button"
        className={buttonClassName}
        render={renderElement}
        {...props}
      />
    );
  }

  return (
    <ButtonPrimitive
      ref={ref}
      data-slot="button"
      className={buttonClassName}
      render={render}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  );
});

export { Button,  };
