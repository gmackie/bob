/**
 * The mobile pull-request list.
 *
 * This is the on-the-road surface: the question a person is answering with a
 * phone in one hand is "is anything waiting on ME?", not "show me every PR".
 * So the list leads with what is blocked on the reader and pushes merged and
 * closed work down, rather than sorting by date and making them hunt.
 */
import { describe, expect, it } from "vitest";

import { buildPrList, prStatusTone } from "./pr-list-model";

const at = (iso: string) => new Date(iso).toISOString();

const rows = [
  { id: "1", number: 10, title: "Old merged", status: "merged", updatedAt: at("2026-09-01T10:00:00Z") },
  { id: "2", number: 11, title: "Needs review", status: "open", reviewState: "changes_requested", updatedAt: at("2026-08-30T10:00:00Z") },
  { id: "3", number: 12, title: "Fresh open", status: "open", updatedAt: at("2026-09-02T10:00:00Z") },
  { id: "4", number: 13, title: "Draft", status: "draft", updatedAt: at("2026-09-03T10:00:00Z") },
];

describe("buildPrList", () => {
  it("puts work that is blocked on the reader first", () => {
    // The whole point of the phone surface: a PR with changes requested is
    // the one thing a person can actually unblock from a train.
    expect(buildPrList(rows).map((r) => r.number)).toEqual([11, 12, 13, 10]);
  });

  it("sorts within a group by most recently updated", () => {
    const merged = buildPrList([
      { id: "a", number: 1, title: "older", status: "merged", updatedAt: at("2026-08-01T00:00:00Z") },
      { id: "b", number: 2, title: "newer", status: "merged", updatedAt: at("2026-09-01T00:00:00Z") },
    ]);

    expect(merged.map((r) => r.number)).toEqual([2, 1]);
  });

  it("marks which rows need the reader, so the UI does not re-derive it", () => {
    const list = buildPrList(rows);

    expect(list.find((r) => r.number === 11)?.needsYou).toBe(true);
    expect(list.find((r) => r.number === 13)?.needsYou).toBe(false);
  });

  it("keeps drafts visible but below open work", () => {
    // A draft is yours to finish; it should not compete with a review request.
    const list = buildPrList(rows);
    const draftIndex = list.findIndex((r) => r.status === "draft");
    const openIndex = list.findIndex((r) => r.status === "open");

    expect(draftIndex).toBeGreaterThan(openIndex);
  });

  it("returns an empty list unchanged rather than inventing a placeholder", () => {
    expect(buildPrList([])).toEqual([]);
  });

  it("tolerates a missing updatedAt instead of dropping the row", () => {
    // A row with no timestamp still matters; sorting it last is better than
    // hiding a PR someone is waiting on.
    const list = buildPrList([{ id: "x", number: 99, title: "No date", status: "open" }]);

    expect(list).toHaveLength(1);
  });
});

describe("prStatusTone", () => {
  it("distinguishes the four states a person acts on differently", () => {
    expect(prStatusTone("open")).not.toBe(prStatusTone("merged"));
    expect(prStatusTone("draft")).not.toBe(prStatusTone("open"));
    expect(prStatusTone("closed")).not.toBe(prStatusTone("merged"));
  });

  it("falls back to a neutral tone for a status it does not know", () => {
    // A new status from the server must not render as an invisible label.
    expect(prStatusTone("some_future_state")).toBeTruthy();
  });
});
