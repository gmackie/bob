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

/**
 * Session / run lifecycle status → badge color. The single source of truth
 * for the vocabulary that was previously hand-redefined (identically, but as
 * partial subsets) in the session/planning run views. Keys are the union of
 * those maps; every shared key had the same color across them, so this is a
 * strict superset with no value conflicts.
 */
export const SESSION_STATUS_COLOR: Record<string, BadgeVariant> = {
  awaiting_input: "amber",
  completed: "emerald",
  error: "rose",
  failed: "rose",
  idle: "slate",
  pending: "amber",
  provisioning: "amber",
  running: "blue",
  starting: "blue",
  stopped: "slate",
  stopping: "amber",
};

/** Session status → badge variant, defaulting to `slate` for unknown states. */
export function sessionStatusVariant(
  status: string | null | undefined,
): BadgeVariant {
  return SESSION_STATUS_COLOR[status ?? ""] ?? "slate";
}

/** Pretty-print a status/priority/kind key for display */
export function formatLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
