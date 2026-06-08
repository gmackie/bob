import { describe, expect, it } from "vitest";

import { formatLifecycleMetadataDetails } from "../lifecycle-timeline-model";

describe("lifecycle timeline model", () => {
  it("formats lifecycle metadata as readable details instead of raw JSON", () => {
    const details = formatLifecycleMetadataDetails({
        toolName: "Bash",
        durationMs: 1532,
        isError: false,
        arguments: {
          command: "pnpm test -- --runInBand",
          description: "Run focused tests",
        },
        result: {
          stdout: "42 tests passed",
          stderr: "",
        },
        rawEnvelope: {
          nested: true,
          ignored: "not directly readable",
        },
      });

    expect(details).toEqual([
      { label: "Tool", value: "Bash" },
      { label: "Duration", value: "1.5s" },
      { label: "Result", value: "Success" },
      { label: "Command", value: "pnpm test -- --runInBand" },
      { label: "Output", value: "42 tests passed" },
      { label: "Envelope", value: "2 fields" },
    ]);
    expect(details.map((detail) => detail.label.toLowerCase())).not.toContain("raw envelope");
  });

  it("keeps error details readable", () => {
    expect(
      formatLifecycleMetadataDetails({
        toolName: "Edit",
        isError: true,
        error: "Patch did not apply",
      }),
    ).toEqual([
      { label: "Tool", value: "Edit" },
      { label: "Result", value: "Error" },
      { label: "Error", value: "Patch did not apply" },
    ]);
  });
});
