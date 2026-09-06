import { describe, expect, it } from "vitest";

import { buildHomeTriage, HOME_SECTION_LIMIT } from "./home-model";

const item = (over: Partial<Parameters<typeof buildHomeTriage>[0]["workItems"][number]>) => ({
  id: "wi_1",
  identifier: "BOB-1",
  title: "Ship it",
  status: "queued",
  updatedAt: "2026-09-01T00:00:00Z",
  ...over,
});

describe("buildHomeTriage", () => {
  it("puts work waiting on a person first", () => {
    const t = buildHomeTriage({
      workItems: [
        item({ id: "a", status: "queued" }),
        item({ id: "b", status: "running" }),
        item({ id: "c", status: "in_review" }),
      ],
    });
    expect(t.sections.map((s) => s.key)).toEqual(["needs_you", "running", "up_next"]);
  });

  it("treats blocked, review-ready and failed as needing a person", () => {
    const t = buildHomeTriage({
      workItems: [
        item({ id: "a", status: "blocked" }),
        item({ id: "b", status: "in_review" }),
        item({ id: "c", status: "failed" }),
        item({ id: "d", status: "running" }),
      ],
    });
    expect(t.needsYouCount).toBe(3);
  });

  it("hides empty sections rather than showing empty headers", () => {
    const t = buildHomeTriage({ workItems: [item({ status: "running" })] });
    expect(t.sections.map((s) => s.key)).toEqual(["running"]);
  });

  it("reports all-clear when there is nothing to triage", () => {
    // `done` belongs in no triage bucket.
    const t = buildHomeTriage({ workItems: [item({ status: "done" })] });
    expect(t.isAllClear).toBe(true);
    expect(t.sections).toEqual([]);
  });

  it("orders each section freshest first", () => {
    const t = buildHomeTriage({
      workItems: [
        item({ id: "old", status: "failed", updatedAt: "2026-01-01T00:00:00Z" }),
        item({ id: "new", status: "failed", updatedAt: "2026-09-05T00:00:00Z" }),
      ],
    });
    expect(t.sections[0]?.rows.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("caps a section and reports the overflow", () => {
    const many = Array.from({ length: HOME_SECTION_LIMIT + 3 }, (_, i) =>
      item({ id: `wi_${i}`, status: "queued" }),
    );
    const s = buildHomeTriage({ workItems: many }).sections[0];
    if (!s) throw new Error("Expected fixture row");
    expect(s.rows).toHaveLength(HOME_SECTION_LIMIT);
    expect(s.overflowCount).toBe(3);
    expect(s.total).toBe(HOME_SECTION_LIMIT + 3);
  });

  it("tones failure red and blocked amber so triage reads at a glance", () => {
    const t = buildHomeTriage({
      workItems: [
        item({ id: "f", status: "failed" }),
        item({ id: "b", status: "blocked" }),
      ],
    });
    const tones = Object.fromEntries(t.sections[0]?.rows.map((r) => [r.id, r.tone]) ?? []);
    expect(tones.f).toBe("danger");
    expect(tones.b).toBe("warning");
  });

  it("links each row at its work item", () => {
    const t = buildHomeTriage({ workItems: [item({ id: "wi_42", status: "failed" })] });
    expect(t.sections[0]?.rows[0]?.href).toBe("/work-items/wi_42");
  });

  it("survives missing titles, identifiers and timestamps", () => {
    const t = buildHomeTriage({
      workItems: [
        { id: "wi_abcdef123", status: "failed", title: null, identifier: null, updatedAt: null },
      ],
    });
    const row = t.sections[0]?.rows[0];
    if (!row) throw new Error("Expected fixture row");
    expect(row.title).toBe("Untitled");
    expect(row.identifier).toBe("wi_abcde");
  });

  it("ignores an unparseable timestamp instead of throwing", () => {
    const t = buildHomeTriage({
      workItems: [item({ id: "x", status: "failed", updatedAt: "not-a-date" })],
    });
    expect(t.sections[0]?.rows[0]?.id).toBe("x");
  });

  it("handles an empty workspace", () => {
    expect(buildHomeTriage({ workItems: [] }).isAllClear).toBe(true);
  });
});
