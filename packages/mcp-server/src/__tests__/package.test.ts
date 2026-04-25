import { describe, it, expect } from "vitest";
import { __gmackoMcpServerPhase } from "@gmacko/mcp-server";

describe("@gmacko/mcp-server package smoke", () => {
  it("resolves via workspace + exports the 6L sentinel", () => {
    expect(__gmackoMcpServerPhase).toBe("6l");
  });
});
