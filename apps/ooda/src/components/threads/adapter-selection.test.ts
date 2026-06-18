import { describe, expect, it } from "vitest";

import {
  chooseDefaultAdapter,
  chooseRunnerForCapabilities,
} from "./adapter-selection";

describe("OODA runner selection", () => {
  it("prefers a runner that has every required capability", () => {
    const runner = chooseRunnerForCapabilities(
      [
        { id: "linux-runner", capabilities: ["codex", "linux"] },
        { id: "gmacko-mini", capabilities: ["codex", "claude", "macos", "darwin"] },
      ],
      ["macos"],
    );

    expect(runner?.id).toBe("gmacko-mini");
    expect(chooseDefaultAdapter(runner)).toBe("claude");
  });

  it("falls back to the first runner when no capabilities are required", () => {
    const runner = chooseRunnerForCapabilities(
      [
        { id: "linux-runner", capabilities: ["codex", "linux"] },
        { id: "gmacko-mini", capabilities: ["codex", "claude", "macos"] },
      ],
      [],
    );

    expect(runner?.id).toBe("linux-runner");
  });
});
