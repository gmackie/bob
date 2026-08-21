import { describe, expect, it } from "vitest";

import { reconcileImportedStatus } from "../reconcileStatus";

/**
 * Kanbanger/Linear owns the queue; Bob mirrors it. The sync used to be
 * insert-only, so moving a card Backlog→Todo in the tracker never promoted the
 * Bob work item and auto-drain starved while the tracker had work. These rules
 * decide, for an already-imported item, whether the tracker's current state
 * should overwrite Bob's status.
 */
describe("reconcileImportedStatus", () => {
  it("promotes a held item when the tracker moves it to Todo", () => {
    expect(reconcileImportedStatus("backlog", "unstarted")).toBe("todo");
    expect(reconcileImportedStatus("draft", "unstarted")).toBe("todo");
  });

  it("demotes an unclaimed item when the tracker moves it back to Backlog", () => {
    expect(reconcileImportedStatus("todo", "backlog")).toBe("backlog");
    expect(reconcileImportedStatus("ready", "backlog")).toBe("backlog");
  });

  it("returns null when nothing would change", () => {
    expect(reconcileImportedStatus("todo", "unstarted")).toBeNull();
    expect(reconcileImportedStatus("backlog", "backlog")).toBeNull();
    expect(reconcileImportedStatus("done", "completed")).toBeNull();
  });

  it("never claims work on the tracker's behalf (started is Bob's to set)", () => {
    // A human (or the legacy task-runner) flipping a card to In Progress must
    // not create a Bob in_progress item with no session behind it — that is
    // exactly the orphan pattern the reaper can't recover.
    expect(reconcileImportedStatus("todo", "started")).toBeNull();
    expect(reconcileImportedStatus("backlog", "started")).toBeNull();
  });

  it("leaves Bob-owned in-flight statuses alone while the card is open", () => {
    expect(reconcileImportedStatus("in_progress", "unstarted")).toBeNull();
    expect(reconcileImportedStatus("in_progress", "backlog")).toBeNull();
    expect(reconcileImportedStatus("in_review", "unstarted")).toBeNull();
    expect(reconcileImportedStatus("in_review", "started")).toBeNull();
  });

  it("honors an external close from any Bob status", () => {
    expect(reconcileImportedStatus("todo", "completed")).toBe("done");
    expect(reconcileImportedStatus("in_progress", "completed")).toBe("done");
    expect(reconcileImportedStatus("in_review", "canceled")).toBe("cancelled");
    expect(reconcileImportedStatus("backlog", "cancelled")).toBe("cancelled");
  });

  it("reopens a finished item when the tracker reopens the card", () => {
    expect(reconcileImportedStatus("done", "unstarted")).toBe("todo");
    expect(reconcileImportedStatus("cancelled", "backlog")).toBe("backlog");
  });

  it("ignores unknown tracker state types", () => {
    expect(reconcileImportedStatus("todo", "triage")).toBeNull();
    expect(reconcileImportedStatus("backlog", "")).toBeNull();
  });
});
