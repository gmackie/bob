import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface WorkspaceNote {
  id: string;
  kind: string;
  title: string;
  content: string;
  artifactId: string;
  sessionId: string;
  promotedAt: string;
  provenanceRef?: string;
}

/**
 * Read all promoted notes from a thread workspace's notes/ directory.
 * Parses YAML frontmatter from markdown files.
 */
export function readNotes(threadDir: string): WorkspaceNote[] {
  const notesDir = join(threadDir, "notes");
  if (!existsSync(notesDir)) return [];

  const files = readdirSync(notesDir).filter((f) => f.endsWith(".md"));
  const notes: WorkspaceNote[] = [];

  for (const file of files) {
    const content = readFileSync(join(notesDir, file), "utf-8");
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const { frontmatter, body } = parsed;

    // Check for provenance file
    const noteId = file.replace(".md", "");
    const provPath = join(threadDir, "sources", `${noteId}.provenance.json`);
    let provenanceRef: string | undefined;
    if (existsSync(provPath)) {
      try {
        const prov = JSON.parse(readFileSync(provPath, "utf-8"));
        provenanceRef = prov.artifactId
          ? `artifact:${prov.artifactId.slice(0, 12)}`
          : undefined;
      } catch {
        // Skip malformed provenance
      }
    }

    notes.push({
      id: frontmatter.id ?? noteId,
      kind: frontmatter.kind ?? "observation",
      title: frontmatter.title ?? extractTitle(body),
      content: body.trim(),
      artifactId: frontmatter.artifactId ?? "",
      sessionId: frontmatter.sessionId ?? "",
      promotedAt: frontmatter.promotedAt ?? "",
      provenanceRef,
    });
  }

  // Sort by promotedAt descending (newest first)
  return notes.sort(
    (a, b) =>
      new Date(b.promotedAt).getTime() - new Date(a.promotedAt).getTime(),
  );
}

function parseFrontmatter(
  content: string,
): { frontmatter: Record<string, string>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter: Record<string, string> = {};
  const lines = match[1]!.split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: match[2]! };
}

function extractTitle(body: string): string {
  const firstLine = body.split("\n").find((l) => l.trim().length > 0);
  if (!firstLine) return "Untitled";
  return firstLine.replace(/^#+\s*/, "").slice(0, 100);
}
