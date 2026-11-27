import { describe, expect, it } from "vitest";

import {
  appendRecurrence,
  normalizeTitle,
  resolveRecurrence,
} from "../title-recurrence";

const incoming = {
  title: "Fix critical errors for bob",
  provider: "linear",
  externalId: "issue-9",
  externalUrl: "https://linear.example/issue/9",
};

describe("normalizeTitle", () => {
  it("ignores case, surrounding space and runs of whitespace", () => {
    expect(normalizeTitle("  Fix   Critical  Errors ")).toBe(
      "fix critical errors",
    );
  });

  it("collapses a newline the same as a space", () => {
    expect(normalizeTitle("Fix\ncritical\terrors")).toBe("fix critical errors");
  });

  it("leaves distinct titles distinct", () => {
    expect(normalizeTitle("Fix errors for bob")).not.toBe(
      normalizeTitle("Fix errors for ooda"),
    );
  });
});

describe("resolveRecurrence", () => {
  it("folds a recurrence into an open item instead of duplicating it", () => {
    // The production shape: a weekly job mints a new issue id for the same
    // title, so the external-id lookup misses and a ninth copy is created
    // while eight are still in backlog.
    const outcome = resolveRecurrence({
      incoming,
      candidates: [
        { id: "wi-1", title: "Fix critical errors for bob", status: "backlog" },
      ],
      now: new Date("2026-09-20T12:00:00.000Z"),
    });

    expect(outcome.create).toBe(false);
    if (outcome.create) throw new Error("expected a reuse");
    expect(outcome.reuseWorkItemId).toBe("wi-1");
    expect(outcome.recurrence).toEqual({
      provider: "linear",
      id: "issue-9",
      url: "https://linear.example/issue/9",
      seenAt: "2026-09-20T12:00:00.000Z",
    });
  });

  it("creates a new item when every prior copy is finished", () => {
    // A title recurring after the work was done is the work happening again.
    for (const status of ["done", "cancelled", "canceled", "failed"]) {
      const outcome = resolveRecurrence({
        incoming,
        candidates: [
          { id: "wi-1", title: "Fix critical errors for bob", status },
        ],
      });
      expect(outcome.create).toBe(true);
    }
  });

  it("matches across case and whitespace differences", () => {
    const outcome = resolveRecurrence({
      incoming,
      candidates: [
        { id: "wi-1", title: "fix  CRITICAL   errors for BOB ", status: "todo" },
      ],
    });
    expect(outcome.create).toBe(false);
  });

  it("does not merge a different title", () => {
    expect(
      resolveRecurrence({
        incoming,
        candidates: [
          { id: "wi-1", title: "Fix critical errors for ooda", status: "todo" },
        ],
      }).create,
    ).toBe(true);
  });

  it("never merges on an empty title, which carries no identity", () => {
    expect(
      resolveRecurrence({
        incoming: { ...incoming, title: "   " },
        candidates: [{ id: "wi-1", title: "", status: "todo" }],
      }).create,
    ).toBe(true);
  });

  it("re-checks status itself, so a sloppy query cannot widen the policy", () => {
    // The caller filters in SQL; the policy must not depend on that being right.
    expect(
      resolveRecurrence({
        incoming,
        candidates: [
          { id: "wi-done", title: "Fix critical errors for bob", status: "done" },
          { id: "wi-open", title: "Fix critical errors for bob", status: "todo" },
        ],
      }),
    ).toMatchObject({ create: false, reuseWorkItemId: "wi-open" });
  });

  it("creates when there is nothing to fold into", () => {
    expect(resolveRecurrence({ incoming, candidates: [] }).create).toBe(true);
  });

  it("carries a null url rather than inventing one", () => {
    const outcome = resolveRecurrence({
      incoming: { ...incoming, externalUrl: undefined },
      candidates: [
        { id: "wi-1", title: "Fix critical errors for bob", status: "backlog" },
      ],
    });
    if (outcome.create) throw new Error("expected a reuse");
    expect(outcome.recurrence.url).toBeNull();
  });
});

describe("appendRecurrence", () => {
  const rec = {
    provider: "linear",
    id: "issue-9",
    url: null,
    seenAt: "2026-09-20T12:00:00.000Z",
  };

  it("preserves unrelated metadata keys", () => {
    // `attempts` is read by the dispatcher to decide when to give up, and
    // sourceMetadata is `not null` in the schema, so it carries other work.
    expect(
      appendRecurrence({ attempts: 3, triage_2026_09_23: true }, rec),
    ).toEqual({
      attempts: 3,
      triage_2026_09_23: true,
      recurrences: [rec],
    });
  });

  it("appends to an existing list rather than replacing it", () => {
    const first = { ...rec, id: "issue-8" };
    expect(appendRecurrence({ recurrences: [first] }, rec).recurrences).toEqual([
      first,
      rec,
    ]);
  });

  it("tolerates metadata that is missing, null or the wrong shape", () => {
    for (const bad of [undefined, null, "nonsense", 7, []]) {
      expect(appendRecurrence(bad, rec)).toEqual({ recurrences: [rec] });
    }
  });

  it("replaces a recurrences value that is not a list", () => {
    expect(appendRecurrence({ recurrences: "broken" }, rec).recurrences).toEqual(
      [rec],
    );
  });
});
