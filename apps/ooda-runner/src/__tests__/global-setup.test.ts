import { existsSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import setup from "./global-setup";

it("isolates HOME and cleans up after an unchanged suite", () => {
  const originalHome = process.env.HOME;
  const teardown = setup();
  const home = homedir();
  try {
    expect(home).not.toBe(originalHome);
    expect(existsSync(join(home, ".bob-runner", "event-buffer", "sentinel"))).toBe(true);
  } finally {
    teardown();
  }
  expect(process.env.HOME).toBe(originalHome);
  expect(existsSync(home)).toBe(false);
});

it.each(["added", "changed", "deleted"])("rejects %s home-directory state and still cleans up", (mutation) => {
  const originalHome = process.env.HOME;
  const teardown = setup();
  const home = homedir();
  const sentinel = join(home, ".bob-runner", "event-buffer", "sentinel");
  try {
    if (mutation === "deleted") rmSync(sentinel);
    else writeFileSync(mutation === "added" ? `${sentinel}.new` : sentinel, "fixture frame");
  } finally {
    expect(teardown).toThrow("The runner test suite modified ~/.bob-runner");
  }
  expect(process.env.HOME).toBe(originalHome);
  expect(existsSync(home)).toBe(false);
});
