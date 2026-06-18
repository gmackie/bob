import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ScannedThread {
  slug: string;
  title: string;
  domainPackId: string | null;
  createdAt: string;
}

export function scanThreads(storageRoot: string): ScannedThread[] {
  const threads: ScannedThread[] = [];

  for (const entry of readdirSync(storageRoot)) {
    const threadJsonPath = join(storageRoot, entry, "thread.json");
    try {
      if (!statSync(join(storageRoot, entry)).isDirectory()) continue;
      if (entry.startsWith(".")) continue;
      const meta = JSON.parse(readFileSync(threadJsonPath, "utf-8"));
      threads.push({
        slug: meta.slug ?? entry,
        title: meta.title ?? entry,
        domainPackId: meta.domainPackId ?? null,
        createdAt: meta.createdAt ?? new Date().toISOString(),
      });
    } catch {
      // Skip dirs without thread.json
    }
  }

  return threads;
}
