import { describe, expect, it } from "vitest";

import { canRunAgentBinary } from "../bob-gateway";

describe("canRunAgentBinary", () => {
  const have = (...paths: string[]) => (p: string) => paths.includes(p);

  it("finds a bare command on the search path", () => {
    expect(canRunAgentBinary("codex", ["/usr/local/bin", "/usr/bin"], have("/usr/bin/codex"))).toBe(true);
  });

  it("returns false when the binary is on no path entry (the ENOENT case)", () => {
    expect(canRunAgentBinary("codex", ["/usr/local/bin", "/usr/bin"], have("/usr/bin/claude"))).toBe(false);
  });

  it("respects search order and ignores empty path entries", () => {
    expect(canRunAgentBinary("grok", ["", "/home/bob/.local/bin"], have("/home/bob/.local/bin/grok"))).toBe(true);
    expect(canRunAgentBinary("grok", [""], have("/grok"))).toBe(false);
  });

  it("probes an absolute command directly rather than joining it to the path", () => {
    expect(canRunAgentBinary("/opt/agents/cursor-agent", ["/usr/bin"], have("/opt/agents/cursor-agent"))).toBe(true);
    expect(canRunAgentBinary("/opt/agents/cursor-agent", ["/usr/bin"], have("/usr/bin/cursor-agent"))).toBe(false);
  });

  it("is false when the path is empty", () => {
    expect(canRunAgentBinary("claude", [], () => true)).toBe(false);
  });
});
