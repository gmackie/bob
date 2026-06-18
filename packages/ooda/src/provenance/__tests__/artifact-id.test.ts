import { describe, expect, it } from "vitest";

import { generateArtifactId } from "../artifact-id";

describe("generateArtifactId", () => {
  it("generates a deterministic sha256 content hash", () => {
    const content = "Blackout curtains help sleep quality.";
    const id1 = generateArtifactId(content);
    const id2 = generateArtifactId(content);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("produces different IDs for different content", () => {
    const id1 = generateArtifactId("content A");
    const id2 = generateArtifactId("content B");

    expect(id1).not.toBe(id2);
  });

  it("handles empty content", () => {
    const id = generateArtifactId("");
    expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
