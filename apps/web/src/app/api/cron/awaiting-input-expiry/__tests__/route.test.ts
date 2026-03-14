import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("awaiting-input expiry cron route", () => {
  it("uses planning-named timeout comment helpers", () => {
    const routePath = fileURLToPath(new URL("../route.ts", import.meta.url));
    const source = readFileSync(routePath, "utf8");

    expect(source).not.toContain("postKanbangerComment");
    expect(source).toContain("postPlanningComment");
  });
});
