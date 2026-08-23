import type { OodaTimelineItem } from "~/features/chat/ooda-timeline";
import type { VaultFile } from "~/features/chat/hooks/use-vault-browser";

import type { ArtifactRef } from "./types";

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}

/**
 * Map a timeline item to an openable artifact. Messages and system lines are
 * not artifacts (null); citations/evidence without a URL are also null.
 */
export function artifactFromTimelineItem(item: OodaTimelineItem): ArtifactRef | null {
  switch (item.kind) {
    case "job":
      return {
        type: "agent-job",
        id: item.id,
        title: nonEmpty(item.display) ?? "Agent job",
        jobId: item.jobId ?? item.id,
        status: item.status,
      };
    case "proposal":
      return {
        type: "proposal",
        id: item.id,
        title: nonEmpty(item.display) ?? "Proposal",
        proposalId: item.proposalId ?? item.id,
        status: item.status,
        rationale: item.rationale,
      };
    case "citation":
    case "evidence": {
      const url = nonEmpty(item.url);
      if (!url) return null;
      return { type: "web", id: item.id, title: nonEmpty(item.display) ?? url, url };
    }
    case "tool":
      return {
        type: "raw-output",
        id: item.id,
        title: `Tool · ${item.name}`,
        content: item.result ?? item.display,
      };
    case "message":
    case "system":
      return null;
  }
}

function stringifyFrontmatter(
  frontmatter: Record<string, unknown> | null,
): Record<string, string> | undefined {
  if (!frontmatter) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

export function vaultNoteArtifact(file: VaultFile): ArtifactRef {
  return {
    type: "vault-note",
    id: `vault:${file.relativePath}`,
    title: file.name,
    path: file.relativePath,
    markdown: file.content,
    frontmatter: stringifyFrontmatter(file.frontmatter),
  };
}

export function planOutputArtifact(sessionId: string, title: string, markdown: string): ArtifactRef {
  return { type: "plan-output", id: `plan:${sessionId}`, title, markdown, sessionId };
}

export function rawOutputArtifact(id: string, title: string, content: string): ArtifactRef {
  return { type: "raw-output", id, title, content };
}
