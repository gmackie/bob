function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
}

export function getExecutionSessionLinkedTaskHref(input: {
  workItemId?: string | null;
  linkedTaskUrl?: string | null;
  workspaceId?: string | null;
}): string | null {
  if (input.workItemId) {
    return appendWorkspaceParam(
      `/work-items/${input.workItemId}?view=outcome`,
      input.workspaceId,
    );
  }

  if (input.linkedTaskUrl) {
    return appendWorkspaceParam(input.linkedTaskUrl, input.workspaceId);
  }

  return null;
}
