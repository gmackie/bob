import { describe, expect, it } from "vitest";

import {
  ThreadSchema,
  ThreadStatusSchema,
  NoteSchema,
  NoteKindSchema,
} from "../thread";

describe("ThreadSchema", () => {
  it("validates a complete thread", () => {
    const result = ThreadSchema.parse({
      id: "thread_sleep",
      title: "Improve Sleep Quality",
      slug: "improve-sleep-quality",
      domainPackId: "general-research",
      status: "active",
      createdAt: "2026-03-21T10:00:00Z",
      updatedAt: "2026-03-21T10:00:00Z",
    });

    expect(result.id).toBe("thread_sleep");
    expect(result.slug).toBe("improve-sleep-quality");
  });

  it("rejects a thread with invalid slug characters", () => {
    expect(() =>
      ThreadSchema.parse({
        id: "thread_1",
        title: "Test",
        slug: "has spaces!!",
        status: "active",
        createdAt: "2026-03-21T10:00:00Z",
        updatedAt: "2026-03-21T10:00:00Z",
      }),
    ).toThrow();
  });

  it("accepts all valid statuses", () => {
    for (const status of ["active", "paused", "archived", "completed"]) {
      const result = ThreadStatusSchema.parse(status);
      expect(result).toBe(status);
    }
  });
});

describe("NoteSchema", () => {
  it("validates a promoted note", () => {
    const result = NoteSchema.parse({
      id: "note_abc123",
      threadId: "thread_sleep",
      sessionId: "session_1",
      kind: "observation",
      title: "Blackout curtains help sleep",
      content: "Studies show blackout curtains improve sleep quality...",
      artifactId: "sha256:abc123",
      promotedAt: "2026-03-21T10:30:00Z",
      createdAt: "2026-03-21T10:00:00Z",
    });

    expect(result.kind).toBe("observation");
    expect(result.artifactId).toBe("sha256:abc123");
  });

  it("accepts all valid note kinds", () => {
    for (const kind of [
      "observation",
      "hypothesis",
      "action",
      "reflection",
      "source-extract",
    ]) {
      expect(NoteKindSchema.parse(kind)).toBe(kind);
    }
  });
});
