import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { exportBrief } from "@gmacko/ooda/thread-workspace";

export interface ExportOptions {
  storageRoot: string;
  threadSlug: string;
  title?: string;
}

interface ThreadJson {
  title?: string;
}

export function runExport(opts: ExportOptions): string {
  const threadDir = join(opts.storageRoot, opts.threadSlug);

  if (!existsSync(threadDir)) {
    throw new Error(`Thread not found: ${threadDir}`);
  }

  // Read title from thread.json if not provided
  let title = opts.title;
  if (!title) {
    const threadJsonPath = join(threadDir, "thread.json");
    if (existsSync(threadJsonPath)) {
      try {
        const raw = readFileSync(threadJsonPath, "utf-8");
        const meta = JSON.parse(raw) as ThreadJson;
        title = meta.title ?? opts.threadSlug;
      } catch {
        title = opts.threadSlug;
      }
    } else {
      title = opts.threadSlug;
    }
  }

  return exportBrief({ threadDir, title });
}
