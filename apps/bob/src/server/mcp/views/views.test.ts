import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate } from "../../../../scripts/build-mcp-views";

describe("MCP Apps view bundles", () => {
  it("generated.ts matches the view sources (run scripts/build-mcp-views.ts)", async () => {
    expect(readFileSync(new URL("./generated.ts", import.meta.url), "utf8")).toBe(await generate());
  });
});
