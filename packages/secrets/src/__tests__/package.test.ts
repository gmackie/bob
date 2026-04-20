import { describe, it, expect } from "vitest";
import { __gmackoSecretsPhase } from "@gmacko/secrets";

describe("@gmacko/secrets package smoke", () => {
  it("resolves via workspace + exports the 6D sentinel", () => {
    expect(__gmackoSecretsPhase).toBe("6d");
  });
});
