import { describe, expect, it } from "vitest";

import { digestNotes, renderDigest  } from "../renderDigest";
import type {DigestMetrics} from "../renderDigest";

const base: Omit<DigestMetrics, "notes"> = {
  date: "2026-08-23", dispatched: 12, prsOpened: 6, prsMerged: 3, prsClosed: 1,
  deploysOk: 2, deploysFailed: 0, sessionsCompleted: 15, sessionsErrored: 2, sessionsBlocked: 0,
  reviewsRun: 9, repairsRun: 2,
  queue: { todo: 80, backlog: 284, inProgress: 2, inReview: 9, blocked: 0, done: 182 },
  medianLeadMinutes: 95, capUsed: 12, capTotal: 40,
  agents: [{ agent: "claude", completed: 8, errored: 1 }, { agent: "codex", completed: 7, errored: 1 }],
};

describe("renderDigest", () => {
  it("renders every section with the numbers in it", () => {
    const out = renderDigest({ ...base, notes: [] });
    expect(out).toContain("Bob daily digest — 2026-08-23");
    expect(out).toContain("6 PRs opened · 3 merged (50% of opened)");
    expect(out).toContain("median claim→merge 1h 35m");
    expect(out).toContain("12/40 execute runs used");
    expect(out).toContain("claude 8✓/1✗");
    expect(out).not.toContain("⚠️");
  });
  it("appends notes as warnings", () => {
    expect(renderDigest({ ...base, notes: ["x"] })).toContain("⚠️ x");
  });
  it("handles an idle day without dividing by zero", () => {
    const out = renderDigest({ ...base, prsOpened: 0, prsMerged: 0, medianLeadMinutes: null, agents: [], notes: [] });
    expect(out).toContain("0 PRs opened · 0 merged (0% of opened)");
    expect(out).toContain("median claim→merge n/a");
  });
});

describe("digestNotes", () => {
  it("is quiet on a healthy day", () => {
    expect(digestNotes(base)).toEqual([]);
  });
  it("flags an error-heavy day, a cap-bound queue, failed deploys, blocked items, and a dead agent", () => {
    const notes = digestNotes({
      ...base, sessionsErrored: 50, sessionsCompleted: 4, capUsed: 40, deploysFailed: 1,
      queue: { ...base.queue, blocked: 2 },
      agents: [{ agent: "codex", completed: 0, errored: 12 }],
    });
    expect(notes.join("\n")).toMatch(/Error-heavy/);
    expect(notes.join("\n")).toMatch(/Daily cap \(40\)/);
    expect(notes.join("\n")).toMatch(/failed deploy/);
    expect(notes.join("\n")).toMatch(/blocked after repeated/);
    expect(notes.join("\n")).toMatch(/codex: 12 errors/);
  });
  it("flags PRs opened with zero reviews", () => {
    expect(digestNotes({ ...base, prsMerged: 0, reviewsRun: 0 }).join("\n")).toMatch(/no reviews ran/);
  });
});
