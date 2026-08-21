/**
 * Status reconciliation for work items imported from Linear/Kanbanger.
 *
 * The tracker owns the queue; Bob mirrors it. Backlog is the human gate and
 * Todo is auto-executable, so a card moving Backlog→Todo in the tracker must
 * promote the Bob item (and vice versa) or auto-drain starves while the
 * tracker is full of work.
 *
 * Ownership split:
 *  - Tracker owns the *queue* statuses (backlog / todo) and *closure*
 *    (completed / canceled).
 *  - Bob owns the *in-flight* statuses (in_progress / in_review): they are set
 *    by dispatch and the runner relay, and only Bob may move an item in or out
 *    of them — except an external close, which always wins.
 *  - The tracker's `started` is informational only. Following it would create
 *    in_progress items with no session behind them, which the reaper cannot
 *    recover (the orphan pattern seen in prod).
 */

const BOB_IN_FLIGHT = new Set(["in_progress", "in_review"]);
const BOB_QUEUE = new Set(["backlog", "todo", "ready", "draft", "done", "cancelled", "canceled", "blocked"]);

/**
 * Given the Bob item's current status and the tracker's current workflow
 * state type, return the status Bob should move to, or `null` for no change.
 */
export function reconcileImportedStatus(
  current: string,
  linearStateType: string,
): string | null {
  switch (linearStateType) {
    case "completed":
      return current === "done" ? null : "done";
    case "canceled":
    case "cancelled":
      return current === "cancelled" ? null : "cancelled";
    case "backlog":
    case "unstarted": {
      if (BOB_IN_FLIGHT.has(current)) return null;
      if (!BOB_QUEUE.has(current)) return null;
      const target = linearStateType === "backlog" ? "backlog" : "todo";
      return current === target ? null : target;
    }
    default:
      // "started", "triage", unknown: never claim or demote on the tracker's behalf.
      return null;
  }
}
