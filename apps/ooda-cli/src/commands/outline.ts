import { readFileSync } from "node:fs";

import type { CreateOutlineBundleResult } from "@gmacko/ooda/thread-workspace";
import { createOutlineBundle } from "@gmacko/ooda/thread-workspace";

export interface OutlineOptions {
  storageRoot: string;
  sourceFiles: string[];
  contextFiles?: string[];
  threadSlug?: string;
  now?: Date;
}

export async function runOutline(
  options: OutlineOptions,
): Promise<CreateOutlineBundleResult> {
  return createOutlineBundle({
    storageRoot: options.storageRoot,
    sources: options.sourceFiles.map((filePath) => ({
      filePath,
      content: readFileSync(filePath, "utf8"),
    })),
    context: (options.contextFiles ?? []).map((filePath) => ({
      filePath,
      content: readFileSync(filePath, "utf8"),
    })),
    threadSlug: options.threadSlug,
    now: options.now,
  });
}
