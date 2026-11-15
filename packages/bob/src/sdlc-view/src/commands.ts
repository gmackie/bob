/**
 * The SDLC command protocol (BOB-79, Phase 2). One definition shared by every
 * surface (web, TUI, mobile, plugin), the SdlcEdge Durable Object, and, by
 * shape, the coordinator's edge exporter (packages/bob/coordination/runtime/edge.mjs).
 *
 * Flow:
 *   client --ws ClientCommand--> SdlcEdge DO
 *     DO: viewer allow-list, tier + confirmation check, coordinator online, enqueue in outbox
 *   exporter --POST IngestBatch {..., results?}--> DO
 *   DO --IngestResult {..., commands?: QueuedCommand[]}--> exporter
 *     exporter: coordinator op under the "edge" principal, Idempotency-Key = commandId, actor recorded
 *   exporter --next POST {results: CommandResult[]}--> DO --ws CommandResultMessage--> clients
 *
 * Delivery is at-least-once: the DO re-sends a queued command until a result for
 * its commandId arrives; the coordinator's idempotency replay makes the effect happen once.
 */
import type { ItemSnapshot, PlanSnapshot } from "./model";

/** Coordinator operations the edge may relay. Anything else is refused by the DO and by the exporter. */
export const RELAYED_OPERATIONS = ["ControlPlan", "RetryItem", "CancelItem", "ReconcileItem", "ResolveInput"] as const;
export type RelayedOperation = (typeof RELAYED_OPERATIONS)[number];

export type PlanAction = "start" | "pause" | "resume" | "cancel";

/** 1 = no confirmation; 2 = confirm; 3 = typed confirmation (type the repo or plan name). */
export type Tier = 1 | 2 | 3;

/**
 * Operation input as the client sends it. contractVersion and commandId are
 * added by the exporter/DO; the client never sends contractVersion.
 */
export type CommandInput =
  | { operation: "ControlPlan"; input: { planId: string; expectedVersion: number; action: PlanAction } }
  | { operation: "RetryItem"; input: { itemId: string; expectedVersion: number; previousAttemptId: string; reason: string } }
  | { operation: "CancelItem"; input: { itemId: string; expectedVersion: number } }
  | { operation: "ReconcileItem"; input: { itemId: string } }
  /** answer is encodeAnswers(...) — see attempt.ts. Tier 1. */
  | { operation: "ResolveInput"; input: { itemId: string; attemptId: string; promptId: string; answer: string } };

export function tierOf(command: CommandInput): Tier {
  switch (command.operation) {
    case "ControlPlan":
      return command.input.action === "pause" || command.input.action === "resume" ? 1 : 2;
    case "ReconcileItem":
    case "ResolveInput":
      return 1;
    case "RetryItem":
    case "CancelItem":
      return 2;
  }
}

/** What a confirmation must carry for a tier. Tier 3 types `expected` exactly. */
export type Confirmation = { confirmed: true; typed?: string };

/** ws client → DO. commandId is a client-generated UUID, reused on every retry of the same intent. */
export type ClientCommand = { type: "command"; commandId: string; confirm?: Confirmation } & CommandInput;

/** DO → exporter, in the ingest response. actor is the Bob user id the DO verified. */
export type QueuedCommand = { commandId: string; actor: string; queuedAt: number } & CommandInput;

/** The coordinator's Operation (contract.forge `Operation`). */
export interface CoordinatorOperation {
  contractVersion: "1";
  operationId: string;
  commandId: string;
  state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  resourceId: string;
  resourceVersion: number;
  error?: { code: string; message: string; retryable: boolean };
}

/** Exporter → DO, in the next ingest batch's `results`. */
export type CommandResult =
  | { commandId: string; ok: true; operation: CoordinatorOperation }
  | { commandId: string; ok: false; error: { code: string; message: string; retryable: boolean } };

/** DO → ws clients. */
export type CommandStatusMessage =
  | { type: "commandAccepted"; commandId: string }
  | { type: "commandRejected"; commandId: string; code: CommandRejectCode; message: string }
  | ({ type: "commandResult" } & CommandResult);

export type CommandRejectCode =
  | "forbidden" // not on the viewer allow-list
  | "invalid" // malformed, unknown operation
  | "confirmation-required" // tier 2/3 without (correct) confirmation
  | "coordinator-offline" // no exporter contact within the offline window
  | "rate-limited" // more than COMMAND_LIMITS.maxPerUserPerMinute from this user, across all of their sockets
  | "outbox-full" // maxQueued waiting in all, or maxQueuedPerUser from this user
  | "conflict"; // this commandId was already used for a different operation or input

/** Hard limits the DO enforces. */
export const COMMAND_LIMITS = { maxQueued: 100, maxQueuedPerUser: 20, maxPerUserPerMinute: 30, expireAfterMs: 10 * 60_000 } as const;

const canonical = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canonical)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]))
      : value;

/**
 * The command's identity for idempotency: stable JSON (keys sorted at every level) of
 * operation + input only; commandId and confirm are excluded. A commandId re-sent with
 * a different fingerprint is a different command and is refused as "conflict".
 */
export function commandFingerprint(command: CommandInput): string {
  return JSON.stringify(canonical({ operation: command.operation, input: command.input }));
}

/** One button a surface may draw. `expected` is what tier 3 must type. */
export interface CommandOption { label: string; tier: Tier; command: CommandInput; expected?: string; destructive?: boolean }

/** Plan-level actions allowed by the coordinator's transition table (coordinator.mjs ControlPlan). */
export function planCommands(plan: PlanSnapshot): CommandOption[] {
  const make = (action: PlanAction, label: string, destructive = false): CommandOption => {
    const command: CommandInput = { operation: "ControlPlan", input: { planId: plan.planId, expectedVersion: plan.resourceVersion, action } };
    return { label, tier: tierOf(command), command, destructive };
  };
  switch (plan.state) {
    case "draft": return [make("start", "Start plan"), make("cancel", "Cancel plan", true)];
    case "active": return [make("pause", "Pause plan"), make("cancel", "Cancel plan", true)];
    case "paused": return [make("resume", "Resume plan"), make("cancel", "Cancel plan", true)];
    default: return [];
  }
}

const RETRYABLE: ReadonlySet<string> = new Set(["failed", "execution-unknown"]);
// Mirrors cancellableStates in packages/bob/coordination/runtime/execution.mjs.
const CANCELLABLE: ReadonlySet<string> = new Set(["pending", "ready", "reserved", "running", "waiting-input", "validating", "review", "deploying", "execution-unknown"]);

/** Item-level actions. Retry needs the previous attempt id from the item's execution admission. */
export function itemCommands(item: ItemSnapshot): CommandOption[] {
  const out: CommandOption[] = [];
  const attemptId = (item as { execution?: { attemptId?: string } }).execution?.attemptId;
  if (item.state === "execution-unknown") {
    const command: CommandInput = { operation: "ReconcileItem", input: { itemId: item.itemId } };
    out.push({ label: "Reconcile", tier: tierOf(command), command });
  }
  if (RETRYABLE.has(item.state) && attemptId) {
    const command: CommandInput = { operation: "RetryItem", input: { itemId: item.itemId, expectedVersion: item.resourceVersion, previousAttemptId: attemptId, reason: "Retried from Bob" } };
    out.push({ label: "Retry", tier: tierOf(command), command });
  }
  if (CANCELLABLE.has(item.state)) {
    const command: CommandInput = { operation: "CancelItem", input: { itemId: item.itemId, expectedVersion: item.resourceVersion } };
    out.push({ label: "Cancel item", tier: tierOf(command), command, destructive: true });
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const isVersion = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;

/** Validates an untrusted operation + input pair. Returns null when it is not a relayable command. */
export function parseCommandInput(operation: unknown, input: unknown): CommandInput | null {
  if (!isRecord(input)) return null;
  switch (operation) {
    case "ControlPlan":
      return isId(input.planId) && isVersion(input.expectedVersion) && ["start", "pause", "resume", "cancel"].includes(input.action as string)
        ? { operation, input: { planId: input.planId, expectedVersion: input.expectedVersion, action: input.action as PlanAction } } : null;
    case "RetryItem":
      return isId(input.itemId) && isVersion(input.expectedVersion) && isId(input.previousAttemptId) && typeof input.reason === "string" && input.reason.length >= 1 && input.reason.length <= 2000
        ? { operation, input: { itemId: input.itemId, expectedVersion: input.expectedVersion, previousAttemptId: input.previousAttemptId, reason: input.reason } } : null;
    case "CancelItem":
      return isId(input.itemId) && isVersion(input.expectedVersion) ? { operation, input: { itemId: input.itemId, expectedVersion: input.expectedVersion } } : null;
    case "ReconcileItem":
      return isId(input.itemId) ? { operation, input: { itemId: input.itemId } } : null;
    case "ResolveInput":
      return isId(input.itemId) && isId(input.attemptId) && isId(input.promptId) && typeof input.answer === "string" && input.answer.length >= 1 && input.answer.length <= 16000
        ? { operation, input: { itemId: input.itemId, attemptId: input.attemptId, promptId: input.promptId, answer: input.answer } } : null;
    default:
      return null;
  }
}

/** Validates an untrusted ClientCommand. */
export function parseClientCommand(raw: unknown): ClientCommand | null {
  if (!isRecord(raw) || raw.type !== "command" || !isId(raw.commandId)) return null;
  const parsed = parseCommandInput(raw.operation, raw.input);
  if (!parsed) return null;
  const confirm = isRecord(raw.confirm) && raw.confirm.confirmed === true
    ? { confirmed: true as const, ...(typeof raw.confirm.typed === "string" ? { typed: raw.confirm.typed } : {}) } : undefined;
  return { type: "command", commandId: raw.commandId, ...parsed, ...(confirm ? { confirm } : {}) };
}

const OPERATION_STATES: ReadonlySet<string> = new Set(["accepted", "running", "succeeded", "failed", "cancelled"]);
const isText = (v: unknown, max = 4000): v is string => typeof v === "string" && v.length <= max;
const isError = (v: unknown): v is { code: string; message: string; retryable: boolean } =>
  isRecord(v) && isId(v.code) && isText(v.message) && typeof v.retryable === "boolean";

/** Validates an untrusted CommandResult (exporter → DO). Returns a fresh copy with only the known fields, or null. */
export function parseCommandResult(raw: unknown): CommandResult | null {
  if (!isRecord(raw) || !isId(raw.commandId)) return null;
  if (raw.ok === false) {
    if (!isError(raw.error)) return null;
    const { code, message, retryable } = raw.error;
    return { commandId: raw.commandId, ok: false, error: { code, message, retryable } };
  }
  if (raw.ok !== true || !isRecord(raw.operation)) return null;
  const op = raw.operation;
  if (op.contractVersion !== "1" || !isId(op.operationId) || !isId(op.commandId) || !OPERATION_STATES.has(op.state as string)) return null;
  if (!isId(op.resourceId) || !Number.isSafeInteger(op.resourceVersion) || (op.resourceVersion as number) < 0) return null;
  if (op.error !== undefined && op.error !== null && !isError(op.error)) return null;
  const operation: CoordinatorOperation = {
    contractVersion: "1", operationId: op.operationId, commandId: op.commandId, state: op.state as CoordinatorOperation["state"],
    resourceId: op.resourceId, resourceVersion: op.resourceVersion as number,
    ...(isError(op.error) ? { error: { code: op.error.code, message: op.error.message, retryable: op.error.retryable } } : {}),
  };
  return { commandId: raw.commandId, ok: true, operation };
}

/** Whether `confirm` satisfies `tier`. `expected` is the text tier 3 must match exactly. */
export function confirmationSatisfies(tier: Tier, confirm: Confirmation | undefined, expected?: string): boolean {
  if (tier === 1) return true;
  if (!confirm?.confirmed) return false;
  if (tier === 2) return true;
  return expected !== undefined && confirm.typed === expected;
}
