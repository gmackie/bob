import { getWorkItemOutcomeSessionHref } from "../work-items/work-item-entry-model";

export function getChatPanelSessionHref(
  sessionId: string,
  workspaceId?: string | null,
): string {
  return getWorkItemOutcomeSessionHref(sessionId, workspaceId);
}
