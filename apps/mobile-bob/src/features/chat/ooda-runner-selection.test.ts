import { describe, expect, it } from "vitest";

import {
  chooseOodaAdapter,
  chooseOodaRunnerForCapabilities,
} from "./ooda-runner-selection";

describe("OODA mobile runner selection", () => {
  it("selects a macOS-capable runner when macOS is required", () => {
    const runner = chooseOodaRunnerForCapabilities(
      [
        { id: "linux", capabilities: ["codex", "linux"] },
        { id: "gmacko-mini", capabilities: ["codex", "claude", "macos", "darwin"] },
      ],
      ["macos"],
    );

    expect(runner?.id).toBe("gmacko-mini");
    expect(chooseOodaAdapter(runner)).toBe("claude");
  });

  it("keeps current first-runner behavior when no capability is required", () => {
    const runner = chooseOodaRunnerForCapabilities([
      { id: "linux", capabilities: ["codex", "linux"] },
      { id: "gmacko-mini", capabilities: ["codex", "claude", "macos"] },
    ]);

    expect(runner?.id).toBe("linux");
  });
});
