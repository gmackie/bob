export interface WorkspaceHeaderValues {
  projectId: string | null;
  workspaceId: string | null;
}

function normalizeHeaderValue(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function getWorkspaceHeaders(headers: Headers): WorkspaceHeaderValues {
  const workspaceId = headers.get("x-workspace-id");
  const projectId = headers.get("x-project-id");

  return {
    workspaceId: normalizeHeaderValue(workspaceId),
    projectId: normalizeHeaderValue(projectId),
  };
}
