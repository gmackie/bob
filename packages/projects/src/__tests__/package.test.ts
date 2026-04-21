import { describe, it, expect } from "vitest";
import { __gmackoProjectsPhase } from "@gmacko/projects";

describe("@gmacko/projects package smoke", () => {
  it("resolves via workspace + exports the 6D sentinel", () => {
    expect(__gmackoProjectsPhase).toBe("6d");
  });
});
