import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("planning repo sync helpers", () => {
  it("uses planning-named remote request helpers", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../sync-repos.ts"),
      "utf8",
    );

    expect(source).not.toContain("async function kanbangerRequest");
    expect(source).toContain("async function planningRequest");
  });
});
