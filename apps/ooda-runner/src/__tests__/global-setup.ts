import { deepStrictEqual } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Include directory entries as well as bytes, so creating even an empty state
// directory fails the assertion. This tree contains only our own test data.
function snapshot(dir: string): unknown[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => [
      entry.name,
      entry.isDirectory() ? snapshot(join(dir, entry.name)) : readFileSync(join(dir, entry.name)),
    ]);
}

export default function setup() {
  const originalHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "ooda-runner-home-"));
  const runnerState = join(home, ".bob-runner");
  for (const name of ["event-buffer", "runs", "budget"]) {
    const dir = join(runnerState, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sentinel"), Buffer.from([0, 1, 127, 255]));
  }
  const before = snapshot(runnerState);
  // Set before workers start, including for modules that capture homedir() at
  // import time and subprocesses. Never inspect or mutate the real user's state.
  process.env.HOME = home;

  return () => {
    try {
      deepStrictEqual(snapshot(runnerState), before,
        "The runner test suite modified ~/.bob-runner; use temporary state overrides");
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      rmSync(home, { recursive: true, force: true });
    }
  };
}
