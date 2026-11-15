import { describe, expect, it } from "vitest";
import {
  COMMAND_LIMITS,
  commandFingerprint,
  confirmationSatisfies,
  itemCommands,
  parseClientCommand,
  parseCommandInput,
  parseCommandResult,
  planCommands,
  tierOf,
  type CommandInput,
  type ItemSnapshot,
  type PlanSnapshot,
} from "../src";

const plan = (state: PlanSnapshot["state"]): PlanSnapshot => ({
  planId: "p1", resourceVersion: 4, state, definition: { items: [], dependencies: [], concurrencyLimit: 1 },
});
const target = { environmentId: "e", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "bob" } };
const item = (state: ItemSnapshot["state"], attemptId?: string): ItemSnapshot => ({
  itemId: "i1", planId: "p1", resourceVersion: 7, state, currentAttemptId: attemptId ?? null,
  execution: attemptId ? { attemptId, target, thread: { environmentId: "e", projectId: "bob", threadId: "t" } } : null,
  achievedMilestones: [], operationIds: [], evidenceRefs: [],
});

describe("tierOf", () => {
  it("pause/resume and reconcile are tier 1; start, cancel, retry and item cancel are tier 2", () => {
    const control = (action: "start" | "pause" | "resume" | "cancel"): CommandInput => ({ operation: "ControlPlan", input: { planId: "p", expectedVersion: 1, action } });
    expect(tierOf(control("pause"))).toBe(1);
    expect(tierOf(control("resume"))).toBe(1);
    expect(tierOf(control("start"))).toBe(2);
    expect(tierOf(control("cancel"))).toBe(2);
    expect(tierOf({ operation: "ReconcileItem", input: { itemId: "i" } })).toBe(1);
    expect(tierOf({ operation: "RetryItem", input: { itemId: "i", expectedVersion: 1, previousAttemptId: "a", reason: "r" } })).toBe(2);
    expect(tierOf({ operation: "CancelItem", input: { itemId: "i", expectedVersion: 1 } })).toBe(2);
  });
});

describe("confirmationSatisfies", () => {
  it("tier 1 needs nothing; tier 2 needs confirmed; tier 3 needs the exact expected text", () => {
    expect(confirmationSatisfies(1, undefined)).toBe(true);
    expect(confirmationSatisfies(2, undefined)).toBe(false);
    expect(confirmationSatisfies(2, { confirmed: true })).toBe(true);
    expect(confirmationSatisfies(3, { confirmed: true }, "bob")).toBe(false);
    expect(confirmationSatisfies(3, { confirmed: true, typed: "Bob" }, "bob")).toBe(false);
    expect(confirmationSatisfies(3, { confirmed: true, typed: "bob " }, "bob")).toBe(false);
    expect(confirmationSatisfies(3, { confirmed: true, typed: "bob" }, "bob")).toBe(true);
    // Nothing to compare against: never satisfied, even by an empty string.
    expect(confirmationSatisfies(3, { confirmed: true, typed: "" }, undefined)).toBe(false);
    expect(confirmationSatisfies(3, { confirmed: true }, undefined)).toBe(false);
  });
});

describe("parseCommandInput / parseClientCommand", () => {
  it("accepts each relayed operation and keeps only known fields", () => {
    expect(parseClientCommand({ type: "command", commandId: "c1", operation: "ControlPlan", input: { planId: "p", expectedVersion: 2, action: "pause", extra: 1 }, junk: true })).toEqual({
      type: "command", commandId: "c1", operation: "ControlPlan", input: { planId: "p", expectedVersion: 2, action: "pause" },
    });
    expect(parseCommandInput("RetryItem", { itemId: "i", expectedVersion: 1, previousAttemptId: "a", reason: "x" })).toEqual({ operation: "RetryItem", input: { itemId: "i", expectedVersion: 1, previousAttemptId: "a", reason: "x" } });
    expect(parseCommandInput("CancelItem", { itemId: "i", expectedVersion: 3 })).toEqual({ operation: "CancelItem", input: { itemId: "i", expectedVersion: 3 } });
    expect(parseCommandInput("ReconcileItem", { itemId: "i" })).toEqual({ operation: "ReconcileItem", input: { itemId: "i" } });
  });
  it("keeps a confirmation only when confirmed is exactly true, and typed only when it is a string", () => {
    const base = { type: "command", commandId: "c", operation: "CancelItem", input: { itemId: "i", expectedVersion: 1 } };
    expect(parseClientCommand({ ...base, confirm: { confirmed: true, typed: "bob" } })?.confirm).toEqual({ confirmed: true, typed: "bob" });
    expect(parseClientCommand({ ...base, confirm: { confirmed: true, typed: 5 } })?.confirm).toEqual({ confirmed: true });
    expect(parseClientCommand({ ...base, confirm: { confirmed: "yes" } })?.confirm).toBeUndefined();
  });
  it("refuses unknown operations, bad ids, versions, actions and reasons", () => {
    const bad: unknown[] = [
      null, "command", [], { type: "hello" },
      { type: "command", commandId: "", operation: "ReconcileItem", input: { itemId: "i" } },
      { type: "command", commandId: "x".repeat(201), operation: "ReconcileItem", input: { itemId: "i" } },
      { type: "command", commandId: "c", operation: "TriggerPlan", input: { planId: "p" } },
      { type: "command", commandId: "c", operation: "ReconcileItem", input: null },
      { type: "command", commandId: "c", operation: "ReconcileItem", input: { itemId: 5 } },
      { type: "command", commandId: "c", operation: "ControlPlan", input: { planId: "p", expectedVersion: 0, action: "pause" } },
      { type: "command", commandId: "c", operation: "ControlPlan", input: { planId: "p", expectedVersion: 1.5, action: "pause" } },
      { type: "command", commandId: "c", operation: "ControlPlan", input: { planId: "p", expectedVersion: 1, action: "delete" } },
      { type: "command", commandId: "c", operation: "RetryItem", input: { itemId: "i", expectedVersion: 1, previousAttemptId: "a", reason: "" } },
      { type: "command", commandId: "c", operation: "RetryItem", input: { itemId: "i", expectedVersion: 1, previousAttemptId: "a", reason: "r".repeat(2001) } },
      { type: "command", commandId: "c", operation: "CancelItem", input: { itemId: "i" } },
    ];
    for (const raw of bad) expect(parseClientCommand(raw)).toBeNull();
  });
});

describe("parseCommandResult", () => {
  const operation = { contractVersion: "1", operationId: "op1", commandId: "c1", state: "succeeded", resourceId: "p1", resourceVersion: 5 };
  it("accepts success and failure results and drops unknown fields", () => {
    expect(parseCommandResult({ commandId: "c1", ok: true, operation: { ...operation, junk: 1 }, junk: 2 })).toEqual({ commandId: "c1", ok: true, operation });
    expect(parseCommandResult({ commandId: "c1", ok: false, error: { code: "stale-version", message: "m", retryable: false } })).toEqual({ commandId: "c1", ok: false, error: { code: "stale-version", message: "m", retryable: false } });
  });
  it("refuses malformed results", () => {
    for (const raw of [
      null, { ok: true, operation }, { commandId: "c1", ok: "true", operation }, { commandId: "c1", ok: true },
      { commandId: "c1", ok: true, operation: { ...operation, contractVersion: "2" } },
      { commandId: "c1", ok: true, operation: { ...operation, state: "done" } },
      { commandId: "c1", ok: true, operation: { ...operation, resourceVersion: "5" } },
      { commandId: "c1", ok: true, operation: { ...operation, error: { code: "x" } } },
      { commandId: "c1", ok: false }, { commandId: "c1", ok: false, error: { code: "x", message: "m" } },
    ]) expect(parseCommandResult(raw)).toBeNull();
  });
});

describe("planCommands", () => {
  const labels = (state: PlanSnapshot["state"]) => planCommands(plan(state)).map((o) => [o.label, o.tier, (o.command.input as { action: string }).action]);
  it("offers the coordinator's transitions per plan state, at the plan's version", () => {
    expect(labels("draft")).toEqual([["Start plan", 2, "start"], ["Cancel plan", 2, "cancel"]]);
    expect(labels("active")).toEqual([["Pause plan", 1, "pause"], ["Cancel plan", 2, "cancel"]]);
    expect(labels("paused")).toEqual([["Resume plan", 1, "resume"], ["Cancel plan", 2, "cancel"]]);
    expect(labels("completed")).toEqual([]);
    expect(labels("cancelled")).toEqual([]);
    expect(planCommands(plan("active"))[0]!.command).toEqual({ operation: "ControlPlan", input: { planId: "p1", expectedVersion: 4, action: "pause" } });
    expect(planCommands(plan("active"))[1]!.destructive).toBe(true);
  });
});

describe("commandFingerprint", () => {
  it("is stable JSON of operation + input, independent of key order, excluding commandId and confirm", () => {
    const a = commandFingerprint({ operation: "CancelItem", input: { itemId: "i", expectedVersion: 2 } });
    const reordered = parseClientCommand({ confirm: { confirmed: true }, input: { expectedVersion: 2, itemId: "i" }, operation: "CancelItem", commandId: "other", type: "command" })!;
    expect(commandFingerprint(reordered)).toBe(a);
    expect(a).toBe('{"input":{"expectedVersion":2,"itemId":"i"},"operation":"CancelItem"}');
    expect(commandFingerprint({ operation: "CancelItem", input: { itemId: "i", expectedVersion: 3 } })).not.toBe(a);
  });
  it("COMMAND_LIMITS carries the per-user caps", () => {
    expect(COMMAND_LIMITS).toMatchObject({ maxQueued: 100, maxQueuedPerUser: 20, maxPerUserPerMinute: 30 });
  });
});

describe("itemCommands", () => {
  const ops = (i: ItemSnapshot) => itemCommands(i).map((o) => o.command.operation);
  it("offers reconcile, retry and cancel by state", () => {
    expect(ops(item("execution-unknown", "a1"))).toEqual(["ReconcileItem", "RetryItem", "CancelItem"]);
    expect(ops(item("failed", "a1"))).toEqual(["RetryItem"]);
    expect(ops(item("running", "a1"))).toEqual(["CancelItem"]);
    expect(ops(item("completed", "a1"))).toEqual([]);
    expect(ops(item("deploying", "a1"))).toEqual(["CancelItem"]); // the coordinator's cancellableStates include it
    expect(ops(item("cancelling", "a1"))).toEqual([]);
  });
  it("retries only with a previous attempt id, at the item's version", () => {
    expect(ops(item("failed"))).toEqual([]);
    expect(itemCommands(item("failed", "a1"))[0]!.command).toEqual({ operation: "RetryItem", input: { itemId: "i1", expectedVersion: 7, previousAttemptId: "a1", reason: "Retried from Bob" } });
  });
});
