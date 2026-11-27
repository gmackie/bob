import type {
  ExplorationCheckIn,
  ExplorationSummary,
  Thread,
} from "@gmacko/core/contracts";

// Keep the RPC client’s decoded Option at the transport boundary.
export type Exploration = Omit<ExplorationSummary, "lastCheckIn"> & {
  lastCheckIn?: ExplorationCheckIn | null;
};
export type ThreadRole = "explorations" | "conversation";

export function threadPaneVisibility(
  width: number,
  fontScale: number,
  threadId?: string,
) {
  // Allow 240pt for titles and 360pt for the check-in/composer at default type.
  const paired = width >= 600 * Math.max(1, fontScale);
  return { list: paired || !threadId, detail: paired || !!threadId };
}

const statusOrder = { awaiting_input: 0, running: 1, paused: 2, completed: 3 };

export function threadExplorations(
  items: readonly Exploration[],
  threadId?: string,
) {
  return items
    .filter((item) => !threadId || item.threadId === threadId)
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
}

export function startExplorationInput(
  thread: Pick<Thread, "id" | "activeBranchId">,
  draft: string,
) {
  const topic = draft.trim();
  return thread.activeBranchId && topic
    ? { threadId: thread.id, branchId: thread.activeBranchId, topic }
    : null;
}
