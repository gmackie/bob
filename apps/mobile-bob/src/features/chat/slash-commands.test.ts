import { describe, expect, it } from "vitest";

import { parseSlashCommand } from "./slash-commands";

describe("parseSlashCommand", () => {
  it("parses command with args", () => {
    expect(parseSlashCommand("/search event sourcing")).toEqual({
      name: "search",
      args: "event sourcing",
    });
  });

  it("parses command without args", () => {
    expect(parseSlashCommand("/help")).toEqual({
      name: "help",
      args: "",
    });
  });

  it("returns null for non-command text", () => {
    expect(parseSlashCommand("hello world")).toBeNull();
  });

  it("returns null for slash in middle of text", () => {
    expect(parseSlashCommand("try /search later")).toBeNull();
  });

  it("handles multiline args", () => {
    const result = parseSlashCommand("/search line1\nline2");
    expect(result?.name).toBe("search");
    expect(result?.args).toBe("line1\nline2");
  });
});
