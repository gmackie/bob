import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

export interface ExportBriefInput {
  threadDir: string;
  title: string;
}

interface ParsedNote {
  id: string;
  artifactId: string;
  kind: string;
  title: string;
  content: string;
  filename: string;
}

interface ProvenanceRef {
  artifactId: string;
  capabilityId: string;
  queryOrInputRef: string;
  canonicalSourceRef?: string;
  retrievedAt: string;
}

function parseNoteFrontmatter(raw: string): ParsedNote | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1]!;
  const body = fmMatch[2]!.trim();

  const idMatch = frontmatter.match(/^id:\s*(.+)$/m);
  const artifactIdMatch = frontmatter.match(/^artifactId:\s*(.+)$/m);
  const kindMatch = frontmatter.match(/^kind:\s*(.+)$/m);

  if (!idMatch || !artifactIdMatch) return null;

  const titleMatch = body.match(/^#\s+(.+)$/m);

  return {
    id: idMatch[1]!.trim(),
    artifactId: artifactIdMatch[1]!.trim(),
    kind: kindMatch?.[1]?.trim() ?? "observation",
    title: titleMatch?.[1]?.trim() ?? "Untitled",
    content: body,
    filename: "",
  };
}

export function exportBrief(input: ExportBriefInput): string {
  const notesDir = join(input.threadDir, "notes");
  const sourcesDir = join(input.threadDir, "sources");

  // Read all notes
  const noteFiles = existsSync(notesDir)
    ? readdirSync(notesDir).filter((f) => f.endsWith(".md")).sort()
    : [];

  if (noteFiles.length === 0) {
    return `# ${input.title}\n\n*No research notes promoted yet.*\n`;
  }

  // Load provenance records
  const provenanceMap = new Map<string, ProvenanceRef>();
  if (existsSync(sourcesDir)) {
    for (const file of readdirSync(sourcesDir)) {
      if (!file.endsWith(".provenance.json")) continue;
      try {
        const raw = readFileSync(join(sourcesDir, file), "utf-8");
        const record = JSON.parse(raw) as ProvenanceRef;
        provenanceMap.set(record.artifactId, record);
      } catch {
        // Skip malformed provenance
      }
    }
  }

  // Build brief
  const lines: string[] = [];
  const sources: Array<{ index: number; ref: ProvenanceRef }> = [];
  let sourceIndex = 1;

  lines.push(`# ${input.title}`);
  lines.push("");
  lines.push(
    `*Research brief generated ${new Date().toISOString().split("T")[0]}*`,
  );
  lines.push("");

  for (const filename of noteFiles) {
    const raw = readFileSync(join(notesDir, filename), "utf-8");
    const note = parseNoteFrontmatter(raw);
    if (!note) continue;

    const prov = provenanceMap.get(note.artifactId);

    if (prov) {
      lines.push(`### ${note.title} [${sourceIndex}]`);
      sources.push({ index: sourceIndex, ref: prov });
      sourceIndex++;
    } else {
      lines.push(`### ${note.title} [UNVERIFIED]`);
    }

    // Strip the title from content to avoid duplication
    const contentWithoutTitle = note.content
      .replace(/^#\s+.+\n*/m, "")
      .trim();
    lines.push("");
    lines.push(contentWithoutTitle);
    lines.push("");
  }

  // Sources section
  lines.push("## Sources");
  lines.push("");

  if (sources.length === 0) {
    lines.push("*No verified sources.*");
  } else {
    for (const { index, ref } of sources) {
      const url = ref.canonicalSourceRef ?? "no URL available";
      lines.push(
        `[${index}] ${ref.capabilityId}: ${url} (retrieved ${ref.retrievedAt})`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}
