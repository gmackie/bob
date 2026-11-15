import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";

describe("parseArgs", () => {
  it("defaults to running the UI", () => expect(parseArgs([])).toEqual({ command: "run" }));
  it("reads subcommands and --url in either form", () => {
    expect(parseArgs(["login", "--url", "http://localhost:3000"])).toEqual({ command: "login", url: "http://localhost:3000" });
    expect(parseArgs(["--url=https://x", "logout"])).toEqual({ command: "logout", url: "https://x" });
    expect(parseArgs(["demo"])).toEqual({ command: "demo" });
    expect(parseArgs(["-h"])).toEqual({ command: "help" });
  });
  it("rejects unknown arguments and a bare --url", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown/);
    expect(() => parseArgs(["--url"])).toThrow(/needs a value/);
  });
});
