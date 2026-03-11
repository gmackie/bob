export interface TaskWorkspaceWorkItem {
  id: string;
  kind: string;
}

export interface TaskWorkspaceRun {
  sessionId: string | null;
}

export interface TaskWorkspaceTarget {
  canExecute: boolean;
  href: string | null;
  state: "unavailable" | "ready" | "waiting";
}

export function getTaskWorkspaceHref(workItemId: string): string {
  return `/work-items/${workItemId}/workspace`;
}

export function buildChatWorkspaceHref(sessionId: string): string {
  const params = new URLSearchParams({
    mode: "headless",
    session: sessionId,
  });

  return `/chat?${params.toString()}`;
}

export function resolveTaskWorkspaceTarget(input: {
  taskRuns: TaskWorkspaceRun[];
  workItem: TaskWorkspaceWorkItem;
}): TaskWorkspaceTarget {
  if (input.workItem.kind !== "task") {
    return {
      canExecute: false,
      href: null,
      state: "unavailable",
    };
  }

  const activeRun = input.taskRuns.find((run) => run.sessionId != null);
  if (!activeRun?.sessionId) {
    return {
      canExecute: true,
      href: null,
      state: "waiting",
    };
  }

  return {
    canExecute: true,
    href: buildChatWorkspaceHref(activeRun.sessionId),
    state: "ready",
  };
}
