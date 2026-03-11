export interface WorkspaceHeaderValues {
  projectId: string | null;
  workspaceId: string | null;
}

export function getWorkspaceHeaders(headers: Headers): WorkspaceHeaderValues {
  const workspaceId = headers.get("x-workspace-id");
  const projectId = headers.get("x-project-id");

  return {
    workspaceId: workspaceId?.trim() || null,
    projectId: projectId?.trim() || null,
  };
}
