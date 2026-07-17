import { describe, expect, it } from "vitest";
import { claudeOracleArgs } from "./oracle-args";

describe("claudeOracleArgs", () => {
  it("returns nothing when persona does not declare the oracle tool", () => {
    expect(claudeOracleArgs({ allowedTools: ["Read"] }, "/tmp/mcp.json"))
      .toEqual({ mcpArgs: [], toolsToAdd: [] });
  });
  it("returns nothing when there is no mcp config path", () => {
    expect(claudeOracleArgs({ allowedTools: ["mcp__ooda__oracle_query"] }, null))
      .toEqual({ mcpArgs: [], toolsToAdd: [] });
  });
  it("returns mcp-config args and the tool when both opt-in and path are present", () => {
    expect(claudeOracleArgs({ allowedTools: ["mcp__ooda__oracle_query"] }, "/tmp/mcp.json"))
      .toEqual({ mcpArgs: ["--mcp-config", "/tmp/mcp.json"], toolsToAdd: ["mcp__ooda__oracle_query"] });
  });
});
