import { describe, expect, it } from "vitest";
import {
  forgeRepositoryBookmarksInputSchema,
  forgeRepositoryListInputSchema,
} from "../src/routers/forge-repository";
import {
  forgeRevisionGetInputSchema,
  forgeRevisionListInputSchema,
  forgeRevisionRequestIndexInputSchema,
} from "../src/routers/forge-revision";
import {
  forgeRunEventIngestInputSchema,
  forgeRunGetInputSchema,
} from "../src/routers/forge-run";

describe("ForgeGraph router input schemas", () => {
  it("accepts valid repository list input", () => {
    const parsed = forgeRepositoryListInputSchema.safeParse({
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid bookmarks limit", () => {
    const parsed = forgeRepositoryBookmarksInputSchema.safeParse({
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      limit: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts valid revision list and get input", () => {
    expect(
      forgeRevisionListInputSchema.safeParse({
        repoId: "550e8400-e29b-41d4-a716-446655440000",
        limit: 25,
      }).success
    ).toBe(true);

    expect(
      forgeRevisionGetInputSchema.safeParse({
        repoId: "550e8400-e29b-41d4-a716-446655440000",
        revId: "abc123",
      }).success
    ).toBe(true);
  });

  it("accepts valid requestIndex payload", () => {
    const parsed = forgeRevisionRequestIndexInputSchema.safeParse({
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      revId: "abc123",
      changeId: "def456",
      parentRevIds: ["p1", "p2"],
      bookmarks: ["base", "integration"],
      metadata: { taskId: "TASK-1" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts valid run get and event ingest payload", () => {
    expect(forgeRunGetInputSchema.safeParse({ runId: "run-123" }).success).toBe(
      true
    );

    const parsed = forgeRunEventIngestInputSchema.safeParse({
      runId: "run-123",
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      revId: "abc123",
      eventType: "tests_finished",
      testStatus: "pass",
      artifactRefs: [
        {
          type: "junit",
          url: "https://example.com/junit.xml",
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects invalid run event type", () => {
    const parsed = forgeRunEventIngestInputSchema.safeParse({
      runId: "run-123",
      repoId: "550e8400-e29b-41d4-a716-446655440000",
      revId: "abc123",
      eventType: "unknown_event",
    });

    expect(parsed.success).toBe(false);
  });
});
