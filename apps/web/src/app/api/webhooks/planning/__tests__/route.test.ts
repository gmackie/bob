import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("planning webhook route", () => {
  it("returns 400 when the webhook event header is missing", async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    process.env.AUTH_GITHUB_ID ??= "github-test-id";
    process.env.AUTH_GITHUB_SECRET ??= "github-test-secret";
    Object.assign(process.env, { NODE_ENV: "development" });
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://bob.example.internal/api/webhooks/planning", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Missing webhook event header",
    });
  });

  it("uses planning-named local webhook symbols", () => {
    const routePath = fileURLToPath(new URL("../route.ts", import.meta.url));
    const source = readFileSync(routePath, "utf8");

    expect(source).not.toContain("KanbangerTaskPayload");
    expect(source).not.toContain("KanbangerIssueUpdatedPayload");
    expect(source).not.toContain(
      "getLatestTaskRunByKanbangerId as getLatestTaskRunByPlanningItemId",
    );
    expect(source).not.toContain("KanbangerTask as PlanningTask");
    expect(source).toContain("getLatestTaskRunByPlanningItemId");
    expect(source).toContain("PlanningTask");
  });
});
