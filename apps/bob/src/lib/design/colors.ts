import type { badgeVariants } from "@gmacko/core/ui/badge";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/** Work item status → badge color */
export const STATUS_COLOR: Record<string, BadgeVariant> = {
  backlog: "slate",
  todo: "blue",
  in_progress: "amber",
  in_review: "purple",
  done: "emerald",
  canceled: "rose",
};

/** Work item priority → badge color */
export const PRIORITY_COLOR: Record<string, BadgeVariant> = {
  urgent: "rose",
  high: "orange",
  medium: "amber",
  low: "blue",
  none: "slate",
};

/** Work item kind → badge color */
export const KIND_COLOR: Record<string, BadgeVariant> = {
  issue: "blue",
  task: "amber",
  epic: "purple",
};

/** Build status → badge color */
export const BUILD_COLOR: Record<string, BadgeVariant> = {
  queued: "slate",
  running: "blue",
  passed: "emerald",
  failed: "rose",
  canceled: "slate",
};

/** Deployment status → badge color */
export const DEPLOY_COLOR: Record<string, BadgeVariant> = {
  pending: "amber",
  deploying: "blue",
  healthy: "emerald",
  unhealthy: "rose",
  rolled_back: "slate",
};

/** Pretty-print a status/priority/kind key for display */
export function formatLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
