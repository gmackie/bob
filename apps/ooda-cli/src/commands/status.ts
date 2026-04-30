import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface StatusInfo {
  storageRoot: string;
}

interface WorkspaceInfo {
  slug: string;
  healthy: boolean;
}

function listWorkspaces(storageRoot: string): WorkspaceInfo[] {
  if (!existsSync(storageRoot)) return [];

  const entries = readdirSync(storageRoot, { withFileTypes: true });
  const workspaces: WorkspaceInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const threadJsonPath = join(storageRoot, entry.name, "thread.json");
    if (!existsSync(threadJsonPath)) continue;

    const gitDir = join(storageRoot, entry.name, ".git");
    workspaces.push({
      slug: entry.name,
      healthy: existsSync(gitDir),
    });
  }

  return workspaces.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function formatStatus(info: StatusInfo): string {
  const workspaces = listWorkspaces(info.storageRoot);

  const lines = [
    "OODA Status",
    "",
    `  Storage:      ${info.storageRoot}`,
    `  Workspaces:   ${workspaces.length}`,
    "",
  ];

  if (workspaces.length > 0) {
    lines.push("  Workspace Health:");
    for (const ws of workspaces) {
      const icon = ws.healthy ? "ok" : "NO GIT";
      lines.push(`    ${ws.slug.padEnd(30)} [${icon}]`);
    }
  }

  return lines.join("\n");
}
