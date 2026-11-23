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
  type ReleaseStatus,
} from "../src";

const plan = (state: PlanSnapshot["state"]): PlanSnapshot => ({
  planId: "p1", resourceVersion: 4, state, definition: { items: [], dependencies: [], concurrencyLimit: 1 },
});
const target = { environmentId: "e", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "bob" } };
const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);
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
  it("release actions are tier 2; deployments are tier 3", () => {
    for (const action of ["merge", "approve", "open-pr"] as const) {
      expect(tierOf({ operation: "RequestRelease", input: { itemId: "i", attemptId: "a", action, sourceRevision: SHA } })).toBe(2);
    }
    expect(tierOf({ operation: "RequestDeployment", input: { itemId: "i", action: "rollback", artifactRef: "d", stageRef: "production", deploymentRef: "d" } })).toBe(3);
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
    expect(parseCommandInput("RequestRelease", { itemId: "i", attemptId: "a", action: "merge", sourceRevision: SHA, pullRequestRef: "12", junk: 1 }))
      .toEqual({ operation: "RequestRelease", input: { itemId: "i", attemptId: "a", action: "merge", sourceRevision: SHA, pullRequestRef: "12" } });
    expect(parseCommandInput("RequestRelease", { itemId: "i", attemptId: "a", action: "open-pr", sourceRevision: SHA }))
      .toEqual({ operation: "RequestRelease", input: { itemId: "i", attemptId: "a", action: "open-pr", sourceRevision: SHA } });
    expect(parseCommandInput("RequestDeployment", { itemId: "i", action: "rollback", artifactRef: "d1", stageRef: "production", deploymentRef: "d1" }))
      .toEqual({ operation: "RequestDeployment", input: { itemId: "i", action: "rollback", artifactRef: "d1", stageRef: "production", deploymentRef: "d1" } });
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
      { type: "command", commandId: "c", operation: "RequestRelease", input: { itemId: "i", attemptId: "a", action: "close", sourceRevision: SHA } },
      { type: "command", commandId: "c", operation: "RequestRelease", input: { itemId: "i", attemptId: "a", action: "merge", sourceRevision: "abc123" } },
      { type: "command", commandId: "c", operation: "RequestRelease", input: { itemId: "i", attemptId: "a", action: "merge", sourceRevision: SHA.toUpperCase() } },
      { type: "command", commandId: "c", operation: "RequestRelease", input: { attemptId: "a", action: "merge", sourceRevision: SHA } },
      { type: "command", commandId: "c", operation: "RequestRelease", input: { itemId: "i", attemptId: "a", action: "merge", sourceRevision: SHA, pullRequestRef: 12 } },
      { type: "command", commandId: "c", operation: "RequestDeployment", input: { itemId: "i", action: "destroy", artifactRef: "d", stageRef: "production" } },
      { type: "command", commandId: "c", operation: "RequestDeployment", input: { itemId: "i", action: "rollback", artifactRef: "", stageRef: "production" } },
      { type: "command", commandId: "c", operation: "RequestDeployment", input: { itemId: "i", action: "rollback", artifactRef: "d", stageRef: "production", deploymentRef: 3 } },
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

const ops = (i: ItemSnapshot) => itemCommands(i).map((o) => o.command.operation);
describe("itemCommands", () => {
  it("offers reconcile, retry and cancel by state", () => {
    // The coordinator only retries failed/cancelled work; execution-unknown is reconciled.
    expect(ops(item("execution-unknown", "a1"))).toEqual(["ReconcileItem", "CancelItem"]);
    expect(ops(item("failed", "a1"))).toEqual(["RetryItem"]);
    expect(ops(item("cancelled", "a1"))).toEqual(["RetryItem"]);
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

describe("itemCommands: release (BOB-82)", () => {
  const release = (stage: ReleaseStatus["stage"], extra: Partial<ReleaseStatus> = {}): ReleaseStatus => ({ attemptId: "a1", stage, autoMerge: false, updatedAt: "2026-11-15T00:00:00Z", ...extra });
  const withRelease = (state: ItemSnapshot["state"], r: ReleaseStatus, evidenceRefs: string[] = []): ItemSnapshot => ({ ...item(state, "a1"), release: r, evidenceRefs });
  const pr = { repository: target.repository, number: 42, url: "https://git.example/pr/42" };
  const view = (i: ItemSnapshot, p?: PlanSnapshot) => itemCommands(i, p).map((o) => [o.label, o.tier, o.command.operation, (o.command.input as { action?: string }).action]);

  it("offers Merge and Approve at the release head on a review-ready review, with the PR number", () => {
    const i = withRelease("review", release("review-ready", { headSha: SHA, pullRequest: pr }));
    expect(view(i)).toEqual([["Merge", 2, "RequestRelease", "merge"], ["Approve", 2, "RequestRelease", "approve"], ["Cancel item", 2, "CancelItem", undefined]]);
    expect(itemCommands(i)[0]!.command).toEqual({ operation: "RequestRelease", input: { itemId: "i1", attemptId: "a1", action: "merge", sourceRevision: SHA, pullRequestRef: "42" } });
  });
  it("still offers a manual merge nudge when autoMerge is on", () => {
    expect(view(withRelease("review", release("review-ready", { headSha: SHA, autoMerge: true })))[0]).toEqual(["Merge now", 2, "RequestRelease", "merge"]);
  });
  it("offers no merge without a head, outside review, or before review-ready", () => {
    expect(ops(withRelease("review", release("review-ready")))).toEqual(["CancelItem"]);
    expect(ops(withRelease("validating", release("checks-running", { headSha: SHA })))).toEqual(["CancelItem"]);
    expect(ops(withRelease("review", release("checks-running", { headSha: SHA })))).toEqual(["CancelItem"]);
  });
  it("offers Retry publish on a blocked or awaiting-publish release, at the head or else the latest commit evidence", () => {
    const blocked = withRelease("validating", release("blocked", { headSha: SHA, note: "push failed" }));
    expect(view(blocked)[0]).toEqual(["Retry publish", 2, "RequestRelease", "open-pr"]);
    expect((itemCommands(blocked)[0]!.command.input as { sourceRevision: string }).sourceRevision).toBe(SHA);
    const awaiting = withRelease("validating", release("awaiting-publish"), [`commit:${SHA}`, "thread:x", `commit:${SHA2}`]);
    expect((itemCommands(awaiting)[0]!.command.input as { sourceRevision: string }).sourceRevision).toBe(SHA2);
    expect(ops(withRelease("validating", release("awaiting-publish"), ["thread:x", "commit:nope"]))).toEqual(["CancelItem"]);
  });
  it("offers Roll back (tier 3, type the repository) once a deployment exists", () => {
    const deployed = withRelease("completed", release("production-verified", { deploymentId: "dep-9" }));
    const [rollback] = itemCommands(deployed);
    expect(rollback).toMatchObject({ label: "Roll back", tier: 3, expected: "bob", destructive: true });
    expect(rollback!.command).toEqual({ operation: "RequestDeployment", input: { itemId: "i1", action: "rollback", artifactRef: "dep-9", stageRef: "production", deploymentRef: "dep-9" } });
    expect(ops(withRelease("deploying", release("deploying", { deploymentId: "dep-9" })))).toEqual(["RequestDeployment", "CancelItem"]);
    expect(ops(withRelease("deploying", release("merged", { deploymentId: "dep-9" })))).toEqual(["CancelItem"]);
    expect(ops(withRelease("deploying", release("deploying")))).toEqual(["CancelItem"]);
  });
  it("takes the rollback repository from the plan when the item has no execution target", () => {
    const p: PlanSnapshot = { ...plan("active"), definition: { items: [{ itemId: "i1", issue: { integrationId: "k", workspaceId: "w", teamId: "t", projectId: "p", issueId: "x" }, target, completionTarget: "production-verified" }], dependencies: [], concurrencyLimit: 1 } };
    const bare: ItemSnapshot = { ...item("completed"), release: release("production-verified", { deploymentId: "dep-9" }) };
    expect(itemCommands(bare)[0]!.expected).toBeUndefined();
    expect(itemCommands(bare, p)[0]!.expected).toBe("bob");
  });
});
