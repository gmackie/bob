import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

import { cn } from "./utils";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        slate:
          "bg-slate-500/15 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
        blue:
          "bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
        amber:
          "bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
        purple:
          "bg-purple-500/15 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
        emerald:
          "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
        rose:
          "bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
        orange:
          "bg-orange-500/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
