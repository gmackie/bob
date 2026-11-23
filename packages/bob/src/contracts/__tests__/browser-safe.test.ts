import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT = /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

// Walks every relative module reachable from the contracts barrel and fails on
// any node: built-in, because web and mobile bundles import this barrel.
function reachableNodeImports(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT)) {
      const spec = match[1] ?? match[2]!;
      if (spec.startsWith("node:")) found.push(`${file}: ${spec}`);
      else if (spec.startsWith(".")) {
        queue.push(resolve(dirname(file), spec).replace(/\.js$/, ".ts"));
      }
    }
  }
  return found;
}

describe("@gmacko/bob/contracts barrel", () => {
  it("reaches no node: built-ins", () => {
    expect(reachableNodeImports(resolve(contractsDir, "index.ts"))).toEqual([]);
  });
});
