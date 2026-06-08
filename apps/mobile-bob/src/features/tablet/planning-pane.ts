const INTERACTIVE_PLANNING_STATUSES = new Set([
  "awaiting-input",
  "awaiting_input",
  "idle",
  "pending",
  "provisioning",
  "running",
  "starting",
]);
const STARTING_PLANNING_STATUSES = new Set(["pending", "provisioning", "starting"]);

export function isPlanningPaneInteractiveStatus(status: string | null | undefined): boolean {
  return INTERACTIVE_PLANNING_STATUSES.has((status ?? "").toLowerCase());
}

export function isPlanningPaneStartingStatus(status: string | null | undefined): boolean {
  return STARTING_PLANNING_STATUSES.has((status ?? "").toLowerCase());
}
