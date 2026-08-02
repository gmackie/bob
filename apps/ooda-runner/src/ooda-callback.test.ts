import { describe, it, expect } from "vitest";

import { oodaCorrelationFrom, buildOutcomeNote } from "./ooda-callback.js";

describe("oodaCorrelationFrom", () => {
  it("prefers threadSlug and keeps threadId", () => {
    expect(
      oodaCorrelationFrom({
        personaConfig: { metadata: { ooda: { threadId: "uuid-1", threadSlug: "my-thread" } } },
      }),
    ).toEqual({ threadSlug: "my-thread", threadId: "uuid-1" });
  });

  it("falls back to threadId as the slug when threadSlug is absent", () => {
    expect(
      oodaCorrelationFrom({ personaConfig: { metadata: { ooda: { threadId: "uuid-1" } } } }),
    ).toEqual({ threadSlug: "uuid-1", threadId: "uuid-1" });
  });

  // Dark by default: any session without an ooda correlation → null → no-op.
  it("returns null for a session with no ooda metadata (the common case)", () => {
    expect(oodaCorrelationFrom({})).toBeNull();
    expect(oodaCorrelationFrom({ personaConfig: {} })).toBeNull();
    expect(oodaCorrelationFrom({ personaConfig: { metadata: {} } })).toBeNull();
    expect(oodaCorrelationFrom({ personaConfig: { metadata: { bizpulse: {} } } })).toBeNull();
  });

  it("returns null when neither threadSlug nor threadId is a usable string", () => {
    expect(oodaCorrelationFrom({ personaConfig: { metadata: { ooda: {} } } })).toBeNull();
    expect(oodaCorrelationFrom({ personaConfig: { metadata: { ooda: { threadId: "  " } } } })).toBeNull();
    expect(oodaCorrelationFrom({ personaConfig: { metadata: { ooda: { threadId: 123 } } } })).toBeNull();
  });
});

describe("buildOutcomeNote", () => {
  it("renders a completed run with PR + branch", () => {
    const note = buildOutcomeNote({
      sessionId: "s1",
      status: "completed",
      title: "Do X",
      pullRequestUrl: "https://git/pr/1",
      branch: "feat/x",
    });
    expect(note.title).toBe("Bob run completed: Do X");
    expect(note.content).toContain("Status: **completed**");
    expect(note.content).toContain("Branch: `feat/x`");
    expect(note.content).toContain("Pull request: https://git/pr/1");
    expect(note.content).toContain("Session: `s1`");
  });

  it("renders a failed run and omits absent PR/branch lines", () => {
    const note = buildOutcomeNote({ sessionId: "s2", status: "failed" });
    expect(note.title).toBe("Bob run failed: s2");
    expect(note.content).toContain("Status: **failed**");
    expect(note.content).not.toContain("Pull request:");
    expect(note.content).not.toContain("Branch:");
  });
});
