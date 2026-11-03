import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runnerStateDir } from "../bob-gateway.js";

// BOB-64: tests must never resolve the live runner's ~/.bob-runner state.
describe("runnerStateDir", () => {
  const saved = process.env.BOB_RUNNER_BUFFER_DIR;

  afterEach(() => {
    process.env.BOB_RUNNER_BUFFER_DIR = saved;
  });

  it("is pointed away from the home directory by the test setup", () => {
    const dir = runnerStateDir("BOB_RUNNER_BUFFER_DIR", "event-buffer");
    expect(dir).toBe(saved);
    expect(dir.startsWith(join(homedir(), ".bob-runner"))).toBe(false);
  });

  it("refuses the home-directory default under vitest", () => {
    delete process.env.BOB_RUNNER_BUFFER_DIR;
    expect(() => runnerStateDir("BOB_RUNNER_BUFFER_DIR", "event-buffer")).toThrow(
      /refusing to use ~\/\.bob-runner\/event-buffer/,
    );
  });
});
