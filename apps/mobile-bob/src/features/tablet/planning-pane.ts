const INTERACTIVE_PLANNING_STATUSES = new Set([
  "awaiting-input",
  "awaiting_input",
  "idle",
  "pending",
  "provisioning",
  "running",
  "starting",
  // Paused awaiting a human decision — the pane stays interactive so the
  // user can respond. ("host_unknown" is intentionally excluded: contact is
  // lost, so there is nothing to interact with.)
  "blocked",
]);
const STARTING_PLANNING_STATUSES = new Set(["pending", "provisioning", "starting"]);

export function isPlanningPaneInteractiveStatus(status: string | null | undefined): boolean {
  return INTERACTIVE_PLANNING_STATUSES.has((status ?? "").toLowerCase());
}

export function isPlanningPaneStartingStatus(status: string | null | undefined): boolean {
  return STARTING_PLANNING_STATUSES.has((status ?? "").toLowerCase());
}
