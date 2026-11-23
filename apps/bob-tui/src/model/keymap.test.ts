import { describe, expect, it } from "vitest";

import { fixtureView, PLAN_ACTIVE, PLAN_DRAFT, PLAN_PAUSED } from "../fixtures";
import { emptyCommands, recordSent, clientCommand } from "./commands";
import { begin, choicesFor, handleKey, initialUi, type KeyContext, type KeyInfo, type UiState } from "./keymap";

const view = fixtureView();
const ctx = (patch: Partial<KeyContext> = {}): KeyContext => ({ view, commands: emptyCommands(), blocked: null, ...patch });
const at = (path: UiState["path"], cursor = 0): UiState => ({ ...initialUi(), path, cursor });
const press = (ui: UiState, input: string, key: KeyInfo = {}, c = ctx()) => handleKey(ui, input, key, c);
const bob = { startupId: "s-bob", repoKey: "forgegraph:gmackie/bob" };
const forge = { startupId: "s-forge", repoKey: "forgegraph:gmackie/forgegraph" };

describe("navigation", () => {
  it("moves with j/k and arrows, clamped", () => {
    let ui = initialUi();
    ui = press(ui, "j").ui;
    expect(ui.cursor).toBe(1);
    ui = press(ui, "", { downArrow: true }).ui;
    expect(ui.cursor).toBe(1);
    ui = press(ui, "k").ui;
    ui = press(ui, "", { upArrow: true }).ui;
    expect(ui.cursor).toBe(0);
  });

  it("enter drills, esc goes back with the cursor on where it came from", () => {
    let ui = press(initialUi(), "j").ui; // ForgeGraph
    ui = press(ui, "", { return: true }).ui;
    expect(ui.path).toEqual({ startupId: "s-forge" });
    ui = press(ui, "", { escape: true }).ui;
    expect(ui).toMatchObject({ path: {}, cursor: 1 });
  });

  it("at the item level j/k move between sibling items and enter does nothing", () => {
    let ui = at({ ...bob, planId: PLAN_ACTIVE, itemId: "item-a1" });
    ui = press(ui, "j").ui;
    expect(ui.path.itemId).toBe("item-a2");
    expect(press(ui, "", { return: true }).ui.path.itemId).toBe("item-a2");
  });

  it("i jumps through the inbox, wrapping", () => {
    let ui = press(initialUi(), "i").ui;
    expect(ui.path.itemId).toBe("item-a1"); // its release is blocked
    ui = press(ui, "i").ui;
    expect(ui.path.itemId).toBe("item-p1");
    ui = press(ui, "i").ui;
    expect(ui.path.itemId).toBe("item-a2");
    for (let n = 0; n < 2; n++) ui = press(ui, "i").ui;
    expect(ui.path.itemId).toBe("item-a1");
  });

  it("q quits and ? toggles help", () => {
    expect(press(initialUi(), "q").effects).toEqual([{ type: "quit" }]);
    const help = press(initialUi(), "?").ui;
    expect(help.mode.kind).toBe("help");
    expect(press(help, "x").ui.mode.kind).toBe("browse");
  });
});

describe("commands", () => {
  it("p pauses an active plan and resumes a paused one, without confirmation (tier 1)", () => {
    const pause = press(at({ ...bob, planId: PLAN_ACTIVE }), "p");
    expect(pause.effects).toEqual([{ type: "send", label: "Pause plan a1c7e5f0", option: expect.objectContaining({ tier: 1, command: { operation: "ControlPlan", input: { planId: PLAN_ACTIVE, expectedVersion: 3, action: "pause" } } }) }]);
    const resume = press(at(forge), "p");
    expect(resume.effects[0]).toMatchObject({ type: "send", option: { command: { input: { action: "resume" } } } });
  });

  it("p on a draft plan explains there is nothing to pause", () => {
    const r = press(at(bob, 1), "p");
    expect(r.effects).toEqual([]);
    expect(r.ui.message).toMatch(/No plan to pause/);
    expect(choicesFor(view, at(bob, 1)).map((c) => c.option.label)).toEqual(["Start plan", "Cancel plan"]);
  });

  it("c on an item asks y/n (tier 2); y sends with confirmation, n does not", () => {
    const ui = at({ ...bob, planId: PLAN_ACTIVE, itemId: "item-a1" });
    const asked = press(ui, "c");
    expect(asked.effects).toEqual([]);
    expect(asked.ui.mode).toMatchObject({ kind: "confirm", choice: { option: { command: { operation: "CancelItem" } }, target: "BOB-71" } });
    expect(press(asked.ui, "y").effects).toEqual([expect.objectContaining({ type: "send", label: "Cancel item BOB-71", confirm: { confirmed: true } })]);
    const no = press(asked.ui, "n");
    expect(no.effects).toEqual([]);
    expect(no.ui.mode.kind).toBe("browse");
  });

  it("c on a failed item never falls through to cancelling the plan", () => {
    const r = press(at({ ...bob, planId: PLAN_ACTIVE, itemId: "item-a2" }), "c");
    expect(r.effects).toEqual([]);
    expect(r.ui.mode.kind).toBe("browse");
    expect(r.ui.message).toMatch(/cannot be cancelled/);
  });

  it("c at the repo level cancels the cursor's plan (tier 2)", () => {
    const r = press(at(forge), "c");
    expect(r.ui.mode).toMatchObject({ kind: "confirm", choice: { option: { tier: 2, command: { operation: "ControlPlan", input: { action: "cancel", planId: PLAN_PAUSED } } } } });
  });

  it("r retries a failed item with its previous attempt, confirmed", () => {
    const asked = press(at({ ...bob, planId: PLAN_ACTIVE }, 1), "r");
    expect(asked.ui.mode).toMatchObject({ kind: "confirm", choice: { option: { command: { operation: "RetryItem", input: { itemId: "item-a2", previousAttemptId: "att-a2" } } } } });
    const none = press(at({ ...bob, planId: PLAN_ACTIVE }, 0), "r");
    expect(none.ui.message).toMatch(/Retry needs/);
  });

  it("the palette lists plan then item commands and runs one by number", () => {
    const ui = at({ ...bob, planId: PLAN_ACTIVE, itemId: "item-a3" });
    const open = press(ui, ":");
    expect(open.ui.mode.kind === "palette" && open.ui.mode.choices.map((c) => c.option.label)).toEqual(["Pause plan", "Cancel plan", "Reconcile", "Cancel item"]);
    expect(press(open.ui, "3").effects).toEqual([expect.objectContaining({ type: "send", label: "Reconcile BOB-73" })]);
    const moved = press(open.ui, "j").ui;
    expect(press(moved, "", { return: true }).ui.mode.kind).toBe("confirm");
    expect(press(open.ui, "", { escape: true }).ui.mode.kind).toBe("browse");
  });

  it("refuses while blocked, and while the resource has a command in flight", () => {
    const blocked = press(at(forge), "p", {}, ctx({ blocked: "the coordinator is offline" }));
    expect(blocked.effects).toEqual([]);
    expect(blocked.ui.message).toBe("Resume plan: the coordinator is offline");
    const option = choicesFor(view, at(forge))[0]!.option;
    const commands = recordSent(emptyCommands(), clientCommand("c1", option), "Resume plan b2d8f6a1", 0);
    const busy = press(at(forge), "p", {}, ctx({ commands }));
    expect(busy.effects).toEqual([]);
    expect(busy.ui.message).toMatch(/Waiting for "Resume plan b2d8f6a1"/);
  });

  it("tier 3 needs the exact text typed", () => {
    const option = { label: "Deploy", tier: 3 as const, expected: "gmackie/bob", command: { operation: "ReconcileItem" as const, input: { itemId: "item-a3" } } };
    let r = begin(initialUi(), { option, target: "BOB-73" }, ctx());
    expect(r.ui.mode).toMatchObject({ kind: "typed", expected: "gmackie/bob", text: "" });
    for (const ch of "gmackie/bo") r = press(r.ui, ch);
    r = press(r.ui, "", { return: true });
    expect(r.effects).toEqual([]);
    expect(r.ui.message).toBe("Type gmackie/bob exactly to confirm.");
    r = press(r.ui, "b");
    r = press(r.ui, "x");
    r = press(r.ui, "", { backspace: true });
    r = press(r.ui, "", { return: true });
    expect(r.effects).toEqual([expect.objectContaining({ type: "send", confirm: { confirmed: true, typed: "gmackie/bob" } })]);
  });

  it("tier 3 without an expected text is refused", () => {
    const option = { label: "Deploy", tier: 3 as const, command: { operation: "ReconcileItem" as const, input: { itemId: "x" } } };
    expect(begin(initialUi(), { option, target: "x" }, ctx()).ui.message).toMatch(/needs typed confirmation/);
  });

  it("draft plans offer start (tier 2) from the palette", () => {
    const open = press(at(bob, 1), ":");
    expect(open.ui.mode.kind).toBe("palette");
    const asked = press(open.ui, "1");
    expect(asked.ui.mode).toMatchObject({ kind: "confirm", choice: { option: { command: { input: { planId: PLAN_DRAFT, action: "start" } } } } });
    expect(press(asked.ui, "y").effects[0]).toMatchObject({ type: "send", confirm: { confirmed: true } });
  });
});

describe("release keys (BOB-82)", () => {
  const a1 = { ...bob, planId: PLAN_ACTIVE, itemId: "item-a1" };
  const base = view.items["item-a1"]!;
  const withItem = (patch: Partial<typeof base>) => ({ ...view, items: { ...view.items, "item-a1": { ...base, ...patch } } });
  const head = base.release!.headSha!;

  it("o retries publishing a blocked release at its head, confirmed", () => {
    const r = press(at(a1), "o");
    expect(r.ui.mode).toMatchObject({ kind: "confirm", choice: { option: { tier: 2, command: { operation: "RequestRelease", input: { itemId: "item-a1", attemptId: "att-a1", action: "open-pr", sourceRevision: head, pullRequestRef: "292" } } } } });
    expect(press(at({ ...bob, planId: PLAN_ACTIVE, itemId: "item-a2" }), "o").ui.message).toMatch(/Retry publish needs/);
  });

  it("m merges a review-ready PR, confirmed", () => {
    const review = withItem({ state: "review", release: { ...base.release!, stage: "review-ready", note: null } });
    const r = press(at(a1), "m", {}, ctx({ view: review }));
    expect(r.ui.mode).toMatchObject({ kind: "confirm", choice: { option: { label: "Merge", command: { operation: "RequestRelease", input: { action: "merge", sourceRevision: head } } } } });
    const sent = press(r.ui, "y", {}, ctx({ view: review }));
    expect(sent.effects).toEqual([expect.objectContaining({ type: "send", confirm: { confirmed: true } })]);
    expect(press(at(a1), "m").ui.message).toMatch(/Merge needs/);
  });

  it("R rolls back a deployment only after the repository is typed", () => {
    const deployed = withItem({ state: "completed", release: { ...base.release!, stage: "production-verified", deploymentId: "dep-9", note: null } });
    let r = press(at(a1), "R", {}, ctx({ view: deployed }));
    expect(r.ui.mode).toMatchObject({ kind: "typed", expected: "gmackie/bob", choice: { option: { tier: 3, command: { operation: "RequestDeployment", input: { action: "rollback", artifactRef: "dep-9", stageRef: "production", deploymentRef: "dep-9" } } } } });
    for (const ch of "gmackie/bob") r = press(r.ui, ch, {}, ctx({ view: deployed }));
    r = press(r.ui, "", { return: true }, ctx({ view: deployed }));
    expect(r.effects).toEqual([expect.objectContaining({ type: "send", confirm: { confirmed: true, typed: "gmackie/bob" } })]);
    expect(press(at(a1), "R").ui.message).toMatch(/Rollback needs/);
  });
});
