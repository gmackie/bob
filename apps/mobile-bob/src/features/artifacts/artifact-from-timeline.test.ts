import { describe, expect, it } from "vitest";

import type { OodaTimelineItem } from "~/features/chat/ooda-timeline";
import type { VaultFile } from "~/features/chat/hooks/use-vault-browser";

import {
  artifactFromTimelineItem,
  planOutputArtifact,
  rawOutputArtifact,
  vaultNoteArtifact,
} from "./artifact-from-timeline";

const base = {
  display: "Display text",
  timestamp: "2026-08-23T00:00:00.000Z",
  sensitivity: "private" as never,
};

describe("artifactFromTimelineItem", () => {
  it("maps a job to an agent-job artifact", () => {
    const item: OodaTimelineItem = { ...base, kind: "job", id: "j1", jobId: "job-9", status: "running" };
    expect(artifactFromTimelineItem(item)).toEqual({
      type: "agent-job",
      id: "j1",
      title: "Display text",
      jobId: "job-9",
      status: "running",
    });
  });

  it("falls back to a default job title and the item id when jobId is missing", () => {
    const item: OodaTimelineItem = { ...base, kind: "job", id: "j1", display: "  " };
    const ref = artifactFromTimelineItem(item);
    expect(ref?.title).toBe("Agent job");
    expect(ref?.type === "agent-job" ? ref.jobId : null).toBe("j1");
  });

  it("maps a proposal with status and rationale", () => {
    const item: OodaTimelineItem = {
      ...base,
      kind: "proposal",
      id: "p1",
      proposalId: "prop-1",
      status: "pending",
      rationale: "Because",
    };
    expect(artifactFromTimelineItem(item)).toEqual({
      type: "proposal",
      id: "p1",
      title: "Display text",
      proposalId: "prop-1",
      status: "pending",
      rationale: "Because",
    });
  });

  it("maps a citation with a url to a web artifact", () => {
    const item: OodaTimelineItem = { ...base, kind: "citation", id: "c1", url: "https://x.test" };
    expect(artifactFromTimelineItem(item)).toEqual({
      type: "web",
      id: "c1",
      title: "Display text",
      url: "https://x.test",
    });
  });

  it("maps evidence with a url to a web artifact, using the url as title when display is empty", () => {
    const item: OodaTimelineItem = { ...base, kind: "evidence", id: "e1", display: "", url: "https://y.test" };
    expect(artifactFromTimelineItem(item)).toEqual({ type: "web", id: "e1", title: "https://y.test", url: "https://y.test" });
  });

  it("returns null for citation/evidence without a url", () => {
    expect(artifactFromTimelineItem({ ...base, kind: "citation", id: "c2" })).toBeNull();
    expect(artifactFromTimelineItem({ ...base, kind: "evidence", id: "e2", url: "" })).toBeNull();
  });

  it("maps a tool to raw-output preferring result over display", () => {
    const withResult: OodaTimelineItem = { ...base, kind: "tool", id: "t1", name: "grep", result: "3 matches" };
    expect(artifactFromTimelineItem(withResult)).toEqual({
      type: "raw-output",
      id: "t1",
      title: "Tool · grep",
      content: "3 matches",
    });
    const withoutResult: OodaTimelineItem = { ...base, kind: "tool", id: "t2", name: "ls" };
    expect(artifactFromTimelineItem(withoutResult)?.type === "raw-output" ? "ok" : "bad").toBe("ok");
    expect((artifactFromTimelineItem(withoutResult) as { content: string }).content).toBe("Display text");
  });

  it("returns null for messages and system items", () => {
    const message: OodaTimelineItem = { ...base, kind: "message", id: "m1", role: "user", deliveryState: "synced" };
    const system: OodaTimelineItem = { ...base, kind: "system", id: "s1", tone: "neutral" };
    expect(artifactFromTimelineItem(message)).toBeNull();
    expect(artifactFromTimelineItem(system)).toBeNull();
  });
});

describe("vaultNoteArtifact", () => {
  it("maps a vault file, stringifying non-string frontmatter and dropping nulls", () => {
    const file: VaultFile = {
      relativePath: "topics/ai.md",
      name: "ai.md",
      content: "# AI",
      frontmatter: { title: "AI", tags: ["a", "b"], draft: false, empty: null },
    };
    expect(vaultNoteArtifact(file)).toEqual({
      type: "vault-note",
      id: "vault:topics/ai.md",
      title: "ai.md",
      path: "topics/ai.md",
      markdown: "# AI",
      frontmatter: { title: "AI", tags: '["a","b"]', draft: "false" },
    });
  });

  it("omits frontmatter when null", () => {
    const file: VaultFile = { relativePath: "a.md", name: "a.md", content: "", frontmatter: null };
    expect(vaultNoteArtifact(file).type === "vault-note" && "frontmatter" in vaultNoteArtifact(file)).toBe(true);
    expect((vaultNoteArtifact(file) as { frontmatter?: unknown }).frontmatter).toBeUndefined();
  });
});

describe("planOutputArtifact / rawOutputArtifact", () => {
  it("builds a plan-output ref keyed by session", () => {
    expect(planOutputArtifact("s1", "Plan", "## Steps")).toEqual({
      type: "plan-output",
      id: "plan:s1",
      title: "Plan",
      markdown: "## Steps",
      sessionId: "s1",
    });
  });

  it("builds a raw-output ref", () => {
    expect(rawOutputArtifact("r1", "Logs", "hello")).toEqual({
      type: "raw-output",
      id: "r1",
      title: "Logs",
      content: "hello",
    });
  });
});
