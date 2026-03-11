import { describe, expect, it } from "vitest";
import { resolveIssueIdsForPayload } from "@/app/api/forge/build-status/route";
import { createFakeDatabase } from "./fake-db";

describe("build status issue resolution", () => {
  it("resolves issue ids by identifier and commit references", async () => {
    const { db } = createFakeDatabase({
      selectResponses: [
        [{ id: "11111111-1111-4111-8111-111111111111" }],
        [{ issueId: "22222222-2222-4222-8222-222222222222" }],
      ],
    });

    const result = await resolveIssueIdsForPayload(db as never, {
      issueIds: ["33333333-3333-4333-8333-333333333333"],
      issueIdentifiers: ["FG-001", "FG-002"],
      commitIds: ["sha-abc", "tag-001"],
      revId: "sha-abc",
      imageTag: "tag-001",
    });

    expect(result).toContain("11111111-1111-4111-8111-111111111111");
    expect(result).toContain("22222222-2222-4222-8222-222222222222");
    expect(result).toContain("33333333-3333-4333-8333-333333333333");
    expect(new Set(result).size).toBe(3);
  });

  it("filters out invalid UUID issueIds", async () => {
    const { db } = createFakeDatabase({
      selectResponses: [
        [],
        [],
      ],
    });

    const result = await resolveIssueIdsForPayload(db as never, {
      issueIds: ["not-a-uuid", "44444444-4444-4444-8444-444444444444"],
      revId: "sha-only",
    });

    expect(result).toEqual(["44444444-4444-4444-8444-444444444444"]);
  });
});
