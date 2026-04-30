import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ThreadListItem {
  title: string;
  slug: string;
  notesCount: number;
  created: string;
}

interface ThreadJson {
  title?: string;
  slug?: string;
  createdAt?: string;
}

export function readThreads(storageRoot: string): ThreadListItem[] {
  if (!existsSync(storageRoot)) return [];

  const entries = readdirSync(storageRoot, { withFileTypes: true });
  const threads: ThreadListItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const threadJsonPath = join(storageRoot, entry.name, "thread.json");
    if (!existsSync(threadJsonPath)) continue;

    try {
      const raw = readFileSync(threadJsonPath, "utf-8");
      const meta = JSON.parse(raw) as ThreadJson;

      const notesDir = join(storageRoot, entry.name, "notes");
      const notesCount = existsSync(notesDir)
        ? readdirSync(notesDir).filter((f) => f.endsWith(".md")).length
        : 0;

      threads.push({
        title: meta.title ?? entry.name,
        slug: meta.slug ?? entry.name,
        notesCount,
        created: meta.createdAt ?? "unknown",
      });
    } catch {
      // Skip malformed thread directories
    }
  }

  return threads.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function formatThreadList(
  threads: ThreadListItem[],
  opts?: { json?: boolean },
): string {
  if (opts?.json) {
    return JSON.stringify(threads, null, 2);
  }

  if (threads.length === 0) {
    return "No threads found. Create one with: ooda new <title>";
  }

  const header = padRow("TITLE", "SLUG", "NOTES", "CREATED");
  const separator = "-".repeat(80);
  const rows = threads.map((t) =>
    padRow(t.title, t.slug, String(t.notesCount), formatDate(t.created)),
  );

  return [header, separator, ...rows].join("\n");
}

function padRow(
  title: string,
  slug: string,
  notes: string,
  created: string,
): string {
  return [
    title.padEnd(30),
    slug.padEnd(25),
    notes.padEnd(8),
    created,
  ].join("  ");
}

function formatDate(iso: string): string {
  if (iso === "unknown") return iso;
  try {
    return iso.split("T")[0] ?? iso;
  } catch {
    return iso;
  }
}
