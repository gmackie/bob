import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { issueCommands, itemCommands, planCommands, type CommandOption, type CoordinatorOperation, type ItemSnapshot, type PlanSnapshot } from "@bob/sdlc-view";

import { ActionsPanel } from "./actions-panel";
import {
  actionButtons,
  commandsToResend,
  confirmationFor,
  confirmPrompt,
  emptyCommands,
  itemTarget,
  latestFor,
  MAX_FINISHED,
  outcomeText,
  parseCommandStatus,
  planTarget,
  reduceCommands,
  resourceIdOf,
  typedConfirmationOk,
  type ActionContext,
  type CommandsState,
} from "./commands-model";
import { createEdgeClient } from "./edge-client";

const plan = (state: PlanSnapshot["state"]): PlanSnapshot => ({
  planId: "plan-1234567890", resourceVersion: 4, state,
  definition: { items: [], dependencies: [], concurrencyLimit: 1 },
});
const item = (state: ItemSnapshot["state"], attemptId: string | null = null): ItemSnapshot => ({
  itemId: "item-a", planId: "plan-1234567890", resourceVersion: 2, state, currentAttemptId: attemptId,
  execution: attemptId ? { attemptId, target: { environmentId: "e", projectId: "p", repository: { integrationId: "forgegraph", repositoryId: "bob" } }, thread: { environmentId: "e", projectId: "p", threadId: "t" } } : null,
  achievedMilestones: [], operationIds: [], evidenceRefs: [],
});
const operation = (state: CoordinatorOperation["state"], extra: Partial<CoordinatorOperation> = {}): CoordinatorOperation =>
  ({ contractVersion: "1", operationId: "op-1", commandId: "c1", state, resourceId: "plan-1234567890", resourceVersion: 5, ...extra });

const live = (commands: CommandsState = emptyCommands()): ActionContext => ({ connection: "live", banner: null, hasView: true, commands });
const labels = (options: CommandOption[]) => options.map((o) => o.label);

function harness() {
  const sent: Array<Record<string, unknown>> = [];
  let n = 0;
  const client = createEdgeClient({ send: (d) => sent.push(JSON.parse(d)), newCommandId: () => `c${++n}` });
  return { client, sent };
}
const pause = planCommands(plan("active"))[0]!;

describe("command lifecycle", () => {
  it("goes pending → accepted → succeeded, with the new resourceVersion in the outcome", () => {
    const h = harness();
    h.client.opened();
    const id = h.client.send(pause.command, pause.label);
    expect(h.sent[1]).toEqual({ type: "command", commandId: "c1", operation: "ControlPlan", input: { planId: "plan-1234567890", expectedVersion: 4, action: "pause" } });
    expect(h.client.commands.entries[id]!.status).toBe("pending");
    expect(h.client.received(JSON.stringify({ type: "commandAccepted", commandId: id }))).toBe(true);
    expect(h.client.commands.entries[id]!.status).toBe("accepted");
    h.client.received(JSON.stringify({ type: "commandResult", commandId: id, ok: true, operation: operation("succeeded") }));
    const entry = h.client.commands.entries[id]!;
    expect(entry.status).toBe("succeeded");
    expect(outcomeText(entry)).toBe("Pause plan: succeeded (now v5)");
    // The view is untouched by status messages.
    expect(h.client.view.epoch).toBeNull();
  });

  it("maps rejects and failures to friendly text", () => {
    let state = emptyCommands();
    const send = (id: string) => { state = reduceCommands(state, { type: "sent", command: { type: "command", commandId: id, ...pause.command }, label: pause.label }); };
    send("a"); send("b"); send("c"); send("d"); send("e");
    state = reduceCommands(state, { type: "commandRejected", commandId: "a", code: "coordinator-offline", message: "offline" });
    state = reduceCommands(state, { type: "commandRejected", commandId: "b", code: "confirmation-required", message: "x" });
    state = reduceCommands(state, { type: "commandRejected", commandId: "c", code: "forbidden", message: "x" });
    state = reduceCommands(state, { type: "commandResult", commandId: "d", ok: false, error: { code: "VersionConflict", message: "Plan version changed", retryable: false } });
    state = reduceCommands(state, { type: "commandResult", commandId: "e", ok: true, operation: operation("failed", { error: { code: "Weird", message: "it broke", retryable: false } }) });
    expect(state.entries.a).toMatchObject({ status: "rejected", error: expect.stringContaining("coordinator is offline") });
    expect(state.entries.b!.error).toContain("needs confirmation");
    expect(state.entries.c!.error).toContain("not allowed");
    expect(state.entries.d).toMatchObject({ status: "failed", error: expect.stringContaining("changed this first") });
    expect(state.entries.e).toMatchObject({ status: "failed", error: "it broke" });
    expect(outcomeText(state.entries.e!)).toBe("Pause plan failed: it broke");
  });

  it("ignores other viewers' commandIds and never reopens a final command", () => {
    const h = harness();
    const id = h.client.send(pause.command, pause.label);
    const before = h.client.commands;
    h.client.received(JSON.stringify({ type: "commandAccepted", commandId: "someone-else" }));
    expect(h.client.commands).toBe(before);
    h.client.received(JSON.stringify({ type: "commandRejected", commandId: id, code: "forbidden", message: "no" }));
    h.client.received(JSON.stringify({ type: "commandAccepted", commandId: id }));
    expect(h.client.commands.entries[id]!.status).toBe("rejected");
  });

  it("resends commands still in flight on a new socket, keeping their commandId", () => {
    const h = harness();
    h.client.opened();
    const pending = h.client.send(pause.command, pause.label);
    const accepted = h.client.send(itemCommands(item("running"))[0]!.command, "Cancel item", { confirmed: true });
    const done = h.client.send(pause.command, pause.label);
    h.client.received(JSON.stringify({ type: "commandAccepted", commandId: accepted }));
    h.client.received(JSON.stringify({ type: "commandResult", commandId: done, ok: true, operation: operation("succeeded") }));
    h.sent.length = 0;
    h.client.opened(); // reconnect
    expect(h.sent[0]).toMatchObject({ type: "hello" });
    expect(h.sent.slice(1).map((m) => m.commandId)).toEqual([pending, accepted]);
    expect(h.sent[2]).toMatchObject({ operation: "CancelItem", confirm: { confirmed: true } });
    expect(commandsToResend(h.client.commands)).toHaveLength(2);
  });

  it("parses only status messages and keeps a bounded history of finished commands", () => {
    expect(parseCommandStatus("nope")).toBeNull();
    expect(parseCommandStatus(JSON.stringify({ type: "delta", seq: 1 }))).toBeNull();
    expect(parseCommandStatus(JSON.stringify({ type: "commandResult", commandId: "x" }))).toBeNull();
    let state = emptyCommands();
    for (let i = 0; i < MAX_FINISHED + 10; i++) {
      state = reduceCommands(state, { type: "sent", command: { type: "command", commandId: `k${i}`, ...pause.command }, label: "Pause plan" });
      state = reduceCommands(state, { type: "commandAccepted", commandId: `k${i}` });
      if (i > 0) state = reduceCommands(state, { type: "commandRejected", commandId: `k${i}`, code: "invalid", message: "" });
    }
    expect(state.order).toHaveLength(MAX_FINISHED + 1);
    expect(state.entries.k0!.status).toBe("accepted"); // in flight: never trimmed
    expect(latestFor(state, "plan-1234567890")!.commandId).toBe(`k${MAX_FINISHED + 9}`);
  });
});

describe("which actions appear", () => {
  it("offers plan actions per plan state", () => {
    expect(labels(planCommands(plan("draft")))).toEqual(["Start plan", "Cancel plan"]);
    expect(labels(planCommands(plan("active")))).toEqual(["Pause plan", "Cancel plan"]);
    expect(labels(planCommands(plan("paused")))).toEqual(["Resume plan", "Cancel plan"]);
    expect(planCommands(plan("completed"))).toEqual([]);
  });
  it("offers item actions per item state", () => {
    expect(labels(itemCommands(item("running")))).toEqual(["Cancel item"]);
    expect(labels(itemCommands(item("failed", "att-1")))).toEqual(["Retry"]);
    expect(labels(itemCommands(item("failed")))).toEqual([]); // retry needs an attempt
    expect(labels(itemCommands(item("execution-unknown", "att-1")))).toEqual(["Reconcile", "Cancel item"]); // reconciled, never retried
    expect(itemCommands(item("completed"))).toEqual([]);
  });
});

describe("expiry, conflict and accepted operations", () => {
  const sent = () => reduceCommands(emptyCommands(), { type: "sent", command: { type: "command", commandId: "x", ...pause.command }, label: "Pause plan" });
  const expiry = { type: "commandResult" as const, commandId: "x", ok: false as const, error: { code: "expired", message: "m", retryable: true } };
  it("lets a later real result replace the edge's synthetic expiry, but nothing else", () => {
    let commands = reduceCommands(sent(), expiry);
    expect(commands.entries.x).toMatchObject({ status: "failed", errorCode: "expired" });
    expect(reduceCommands(commands, { type: "commandAccepted", commandId: "x" })).toBe(commands);
    expect(reduceCommands(commands, { type: "commandRejected", commandId: "x", code: "invalid", message: "" })).toBe(commands);
    commands = reduceCommands(commands, { type: "commandResult", commandId: "x", ok: true, operation: operation("succeeded") });
    expect(commands.entries.x).toMatchObject({ status: "succeeded", operation: { state: "succeeded" } });
    // Now final: a further result is ignored.
    expect(reduceCommands(commands, expiry)).toBe(commands);
  });
  it("does not let a result replace a real failure", () => {
    const failed = reduceCommands(sent(), { type: "commandResult", commandId: "x", ok: false, error: { code: "VersionConflict", message: "m", retryable: false } });
    expect(reduceCommands(failed, { type: "commandResult", commandId: "x", ok: true, operation: operation("succeeded") })).toBe(failed);
  });
  it("explains a conflict rejection", () => {
    const commands = reduceCommands(sent(), { type: "commandRejected", commandId: "x", code: "conflict", message: "raw" });
    expect(commands.entries.x!.error).toBe("This command's id was already used for a different action. Start the action again.");
  });
  it('labels an "accepted" operation as accepted by the coordinator, not as succeeded', () => {
    const commands = reduceCommands(sent(), { type: "commandResult", commandId: "x", ok: true, operation: operation("accepted") });
    expect(outcomeText(commands.entries.x!)).toBe("Pause plan: accepted by the coordinator (now v5)");
    expect(outcomeText(commands.entries.x!)).not.toContain("succeeded");
  });
});

describe("availability", () => {
  const options = planCommands(plan("active"));
  it("enables everything when live, connected and the coordinator is online", () => {
    expect(actionButtons(options, live()).map((b) => [b.key, b.disabled])).toEqual([["ControlPlan:pause", false], ["ControlPlan:cancel", false]]);
  });
  it("keys release actions by action, so Merge and Approve are distinct buttons", () => {
    const review: ItemSnapshot = { ...item("review", "att-1"), release: { attemptId: "att-1", stage: "review-ready", autoMerge: false, headSha: "a".repeat(40), updatedAt: "2026-11-15T00:00:00Z" } };
    expect(actionButtons(itemCommands(review), live()).map((b) => b.key)).toEqual(["RequestRelease:merge", "RequestRelease:approve", "CancelItem"]);
  });
  it("disables all actions with a reason when offline, disconnected or without a view", () => {
    const offline = actionButtons(options, { ...live(), banner: { kind: "coordinator-offline", since: 1 } });
    expect(offline.every((b) => b.disabled && b.reason?.includes("coordinator is offline"))).toBe(true);
    for (const connection of ["connecting", "reconnecting"] as const) {
      expect(actionButtons(options, { ...live(), connection, banner: { kind: connection } }).every((b) => b.disabled && b.reason === "Not connected to the SDLC edge.")).toBe(true);
    }
    expect(actionButtons(options, { ...live(), hasView: false })[0]!.reason).toBe("Waiting for the first snapshot.");
  });
  it("disables a resource's buttons while it has a command in flight, and only that resource's", () => {
    let commands = reduceCommands(emptyCommands(), { type: "sent", command: { type: "command", commandId: "x", ...pause.command }, label: "Pause plan" });
    const buttons = actionButtons(options, live(commands));
    expect(buttons.every((b) => b.disabled && b.pending && b.reason === 'Waiting for "Pause plan" to finish.')).toBe(true);
    expect(actionButtons(itemCommands(item("running")), live(commands))[0]!.disabled).toBe(false);
    commands = reduceCommands(commands, { type: "commandResult", commandId: "x", ok: true, operation: operation("succeeded") });
    expect(actionButtons(options, live(commands)).some((b) => b.disabled)).toBe(false);
  });
});

describe("confirmation", () => {
  const [pauseOpt, cancelOpt] = planCommands(plan("active"));
  const tier3: CommandOption = { ...cancelOpt!, tier: 3, expected: "gmackie/bob" };
  it("runs tier 1 without a dialog and names the action and target for tier 2", () => {
    expect(confirmPrompt(pauseOpt!, planTarget("plan-1234567890"))).toBeNull();
    expect(confirmationFor(pauseOpt!)).toBeUndefined();
    const cancelItem = itemCommands(item("running"))[0]!;
    expect(confirmPrompt(cancelItem, itemTarget("BOB-71", "plan-1234567890"))).toMatchObject({
      title: "Cancel item BOB-71 in plan plan-123?", expected: null, destructive: true,
    });
    expect(confirmationFor(cancelOpt!)).toEqual({ confirmed: true });
  });
  it("requires tier 3 to type the expected text exactly", () => {
    expect(confirmPrompt(tier3, "plan-123")!.expected).toBe("gmackie/bob");
    expect(typedConfirmationOk(tier3, "gmackie/bob")).toBe(true);
    for (const typed of ["", "gmackie/Bob", " gmackie/bob", "gmackie/bob ", "gmackie"]) {
      expect(typedConfirmationOk(tier3, typed)).toBe(false);
      expect(confirmationFor(tier3, typed)).toBeNull();
    }
    expect(confirmationFor(tier3, "gmackie/bob")).toEqual({ confirmed: true, typed: "gmackie/bob" });
    // A tier 3 option without `expected` can never be confirmed.
    expect(typedConfirmationOk({ ...tier3, expected: undefined }, "")).toBe(false);
  });
});

describe("ActionsPanel", () => {
  const render = (context: ActionContext) => renderToStaticMarkup(
    <ActionsPanel label="Plan actions" resourceId="plan-1234567890" options={planCommands(plan("active"))} target="plan-123" context={context} send={() => null} />,
  );
  it("draws destructive actions as destructive and shows the offline reason", () => {
    const html = render({ ...live(), banner: { kind: "coordinator-offline", since: 1 } });
    expect(html).toContain("Pause plan");
    expect(html).toMatch(/<button[^>]*bg-destructive[^>]*disabled=""[^>]*>Cancel plan<\/button>|<button[^>]*disabled=""[^>]*bg-destructive[^>]*>Cancel plan<\/button>/);
    expect(html).toContain("coordinator is offline");
  });
  it("shows a spinner while pending, then the outcome", () => {
    let commands = reduceCommands(emptyCommands(), { type: "sent", command: { type: "command", commandId: "x", ...pause.command }, label: "Pause plan" });
    expect(render(live(commands))).toContain("animate-spin");
    commands = reduceCommands(commands, { type: "commandRejected", commandId: "x", code: "forbidden", message: "" });
    const html = render(live(commands));
    expect(html).not.toContain("animate-spin");
    expect(html).toContain("Pause plan failed: You are not allowed");
  });
  it("draws nothing for a resource with no actions and no history", () => {
    expect(renderToStaticMarkup(<ActionsPanel label="x" resourceId="r" options={[]} target="t" context={live()} send={() => null} />)).toBe("");
  });
});

describe("issue commands (BOB-99)", () => {
  const issue = {
    id: "00000000-0000-4000-8000-000000000001", key: "FORGE-1", title: "t", url: null, state: { name: "In Progress", type: "started" as const },
    project: { id: "p", name: "ForgeGraph" }, team: "GMA", updatedAt: 0, pr: null, dispatchable: true, version: 1,
  };
  it("keys each move by target and tracks the issue as the resource", () => {
    const options = issueCommands(issue);
    expect(options.map((o) => o.label)).toEqual(["Dispatch to an agent", "Move to Todo", "Move to In Review", "Move to Done", "Move to Canceled"]);
    const buttons = actionButtons(options, { connection: "live", banner: null, hasView: true, commands: emptyCommands() });
    expect(new Set(buttons.map((b) => b.key)).size).toBe(options.length);
    expect(resourceIdOf(options[1]!.command)).toBe(issue.id);
  });
});
