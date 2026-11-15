// The /sdlc command lifecycle and action availability, without a socket or React, so node tests cover it.
// edge-client.ts feeds it; actions-panel.tsx draws it.
import type {
  ClientCommand,
  CommandInput,
  CommandOption,
  CommandStatusMessage,
  Confirmation,
  CoordinatorOperation,
} from "@bob/sdlc-view";

import type { Banner } from "./sdlc-page-model";

/**
 * pending: sent, not yet acknowledged by the edge. accepted: queued in the edge outbox,
 * waiting for the coordinator. The rest are final.
 */
export type CommandStatus = "pending" | "accepted" | "succeeded" | "failed" | "rejected";

export interface CommandEntry {
  commandId: string;
  /** The exact message sent; a resend after a reconnect reuses it, commandId included. */
  command: ClientCommand;
  label: string;
  resourceId: string;
  status: CommandStatus;
  /** Friendly text for rejected and failed commands. */
  error?: string;
  errorCode?: string;
  operation?: CoordinatorOperation;
}

export interface CommandsState {
  entries: Record<string, CommandEntry>;
  /** commandIds, oldest first; trimmed to MAX_FINISHED finished entries. */
  order: string[];
}

export const MAX_FINISHED = 50;

export const emptyCommands = (): CommandsState => ({ entries: {}, order: [] });

export const resourceIdOf = (command: CommandInput): string =>
  command.operation === "ControlPlan" ? command.input.planId : command.input.itemId;

export const isInFlight = (entry: CommandEntry) => entry.status === "pending" || entry.status === "accepted";
/**
 * The edge's synthetic expiry is not final for results: the coordinator may still have
 * run the command, and a late real commandResult replaces it.
 */
export const isExpiry = (entry: CommandEntry) => entry.status === "failed" && entry.errorCode === "expired";

const STATUS_TYPES = new Set(["commandAccepted", "commandRejected", "commandResult"]);

/** Parses one socket message; anything that is not a command status message is null. */
export function parseCommandStatus(data: unknown): CommandStatusMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try { value = JSON.parse(data); } catch { return null; }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (!STATUS_TYPES.has(message.type as string) || typeof message.commandId !== "string") return null;
  if (message.type === "commandResult" && typeof message.ok !== "boolean") return null;
  return message as unknown as CommandStatusMessage;
}

const FRIENDLY: Record<string, string> = {
  "confirmation-required": "This action needs confirmation. Try again and confirm it.",
  "coordinator-offline": "The coordinator is offline, so the command was not queued. Try again once it is back.",
  forbidden: "You are not allowed to run SDLC commands.",
  invalid: "The edge did not accept this command as valid.",
  "outbox-full": "Too many commands are queued. Wait for some to finish, then try again.",
  "rate-limited": "Too many commands from this window in the last minute. Wait a moment, then try again.",
  expired: "The coordinator did not pick this command up in time, so it was dropped. Try again.",
  conflict: "This command's id was already used for a different action. Start the action again.",
  InternalError: "The coordinator could not run this command. It will retry; if this persists, try again later.",
  VersionConflict: "Someone else changed this first. The view has the latest state; check it and try again.",
};

/** Friendly text for a reject or failure code, falling back to the server's message. */
export function friendlyError(code: string, message: string): string {
  return FRIENDLY[code] ?? (message || code);
}

export type CommandEvent =
  | { type: "sent"; command: ClientCommand; label: string }
  | CommandStatusMessage;

function trim(state: CommandsState): CommandsState {
  const finished = state.order.filter((id) => !isInFlight(state.entries[id]!));
  if (finished.length <= MAX_FINISHED) return state;
  const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED));
  const entries = { ...state.entries };
  for (const id of drop) delete entries[id];
  return { entries, order: state.order.filter((id) => !drop.has(id)) };
}

/**
 * Folds a send or a status message into the command state. Status messages for
 * commandIds this client did not send (another viewer's results are broadcast too)
 * are ignored, and a final status is never overwritten, except that a real
 * commandResult replaces an expiry (isExpiry).
 */
export function reduceCommands(state: CommandsState, event: CommandEvent): CommandsState {
  if (event.type === "sent") {
    const { command, label } = event;
    if (state.entries[command.commandId]) return state;
    const entry: CommandEntry = { commandId: command.commandId, command, label, resourceId: resourceIdOf(command), status: "pending" };
    return trim({ entries: { ...state.entries, [entry.commandId]: entry }, order: [...state.order, entry.commandId] });
  }
  const current = state.entries[event.commandId];
  if (!current) return state;
  if (!isInFlight(current) && !(isExpiry(current) && event.type === "commandResult")) return state;
  let next: CommandEntry;
  switch (event.type) {
    case "commandAccepted":
      next = { ...current, status: "accepted" };
      break;
    case "commandRejected":
      next = { ...current, status: "rejected", errorCode: event.code, error: friendlyError(event.code, event.message) };
      break;
    case "commandResult":
      if (!event.ok) {
        next = { ...current, status: "failed", errorCode: event.error.code, error: friendlyError(event.error.code, event.error.message) };
      } else if (event.operation.state === "failed" || event.operation.state === "cancelled") {
        const error = event.operation.error;
        next = {
          ...current, status: "failed", operation: event.operation,
          errorCode: error?.code ?? event.operation.state,
          error: error ? friendlyError(error.code, error.message) : `The operation was ${event.operation.state}.`,
        };
      } else {
        next = { ...current, status: "succeeded", operation: event.operation };
      }
      break;
  }
  return trim({ ...state, entries: { ...state.entries, [next.commandId]: next } });
}

/**
 * Commands to send again on a new socket, with their original commandId: everything
 * not yet final. The edge dedupes by commandId and the coordinator replays by
 * Idempotency-Key, so a resend never runs an action twice.
 */
export const commandsToResend = (state: CommandsState): ClientCommand[] =>
  state.order.map((id) => state.entries[id]!).filter(isInFlight).map((e) => e.command);

/** The newest command for a resource, to show its pending spinner or outcome. */
export function latestFor(state: CommandsState, resourceId: string): CommandEntry | null {
  for (let i = state.order.length - 1; i >= 0; i--) {
    const entry = state.entries[state.order[i]!]!;
    if (entry.resourceId === resourceId) return entry;
  }
  return null;
}

/** How an Operation's state reads: "accepted" is the coordinator taking it on, not success. */
export const operationStateText = (state: CoordinatorOperation["state"]): string =>
  state === "accepted" ? "accepted by the coordinator" : state;

/** One line for a command's outcome. */
export function outcomeText(entry: CommandEntry): string {
  switch (entry.status) {
    case "pending": return `${entry.label}: sending…`;
    case "accepted": return `${entry.label}: queued for the coordinator…`;
    case "rejected":
    case "failed": return `${entry.label} failed: ${entry.error ?? "unknown error"}`;
    case "succeeded": {
      const op = entry.operation;
      if (!op) return `${entry.label}: done`;
      return `${entry.label}: ${operationStateText(op.state)} (now v${op.resourceVersion})`;
    }
  }
}

// ── Availability ─────────────────────────────────────────────────────────────

export interface ActionContext {
  connection: "connecting" | "live" | "reconnecting";
  banner: Banner | null;
  /** Whether a snapshot has arrived (view.epoch !== null). */
  hasView: boolean;
  commands: CommandsState;
}

export interface ActionButton {
  option: CommandOption;
  /** Stable React key: operation plus action. */
  key: string;
  disabled: boolean;
  reason: string | null;
  /** The resource has a command in flight; the button shows it. */
  pending: boolean;
}

/** Why every action is unavailable right now, or null when commands can be sent. */
export function globalDisabledReason(ctx: Omit<ActionContext, "commands">): string | null {
  if (ctx.connection !== "live") return "Not connected to the SDLC edge.";
  if (!ctx.hasView) return "Waiting for the first snapshot.";
  if (ctx.banner?.kind === "coordinator-offline") return "The coordinator is offline; actions resume when it is back.";
  return null;
}

const keyOf = (option: CommandOption) =>
  option.command.operation === "ControlPlan" ? `ControlPlan:${option.command.input.action}` : option.command.operation;

/** The buttons for a resource's options, each disabled with a reason when it cannot run. */
export function actionButtons(options: CommandOption[], ctx: ActionContext): ActionButton[] {
  const global = globalDisabledReason(ctx);
  return options.map((option) => {
    const latest = latestFor(ctx.commands, resourceIdOf(option.command));
    const pending = !!latest && isInFlight(latest);
    const reason = global ?? (pending ? `Waiting for "${latest!.label}" to finish.` : null);
    return { option, key: keyOf(option), disabled: reason !== null, reason, pending };
  });
}

// ── Confirmation ─────────────────────────────────────────────────────────────

export interface ConfirmPrompt {
  title: string;
  body: string;
  /** Tier 3: what the user must type exactly. */
  expected: string | null;
  confirmLabel: string;
  destructive: boolean;
}

/**
 * The dialog for a tier 2 or 3 option, naming the action and its target, e.g.
 * "Cancel item BOB-71 in plan 1a2b3c4d?". Tier 1 needs none: null.
 */
export function confirmPrompt(option: CommandOption, target: string): ConfirmPrompt | null {
  if (option.tier === 1) return null;
  const expected = option.tier === 3 ? option.expected ?? null : null;
  return {
    title: `${option.label} ${target}?`,
    body: option.destructive ? "This cannot be undone from Bob." : "The coordinator runs this as you.",
    expected,
    confirmLabel: option.label,
    destructive: !!option.destructive,
  };
}

/** Tier 3 is satisfied only by typing `expected` exactly; a tier 3 option without one can never be confirmed. */
export function typedConfirmationOk(option: CommandOption, typed: string): boolean {
  if (option.tier !== 3) return true;
  return option.expected !== undefined && option.expected.length > 0 && typed === option.expected;
}

/** The confirm field for a ClientCommand, or null when the confirmation is not satisfied. */
export function confirmationFor(option: CommandOption, typed = ""): Confirmation | undefined | null {
  if (option.tier === 1) return undefined;
  if (option.tier === 2) return { confirmed: true };
  return typedConfirmationOk(option, typed) ? { confirmed: true, typed } : null;
}

/** The target after an option label ("Cancel plan" + "1a2b3c4d"; "Cancel item" + "BOB-71 in plan 1a2b3c4d"). */
export const planTarget = (planId: string) => planId.slice(0, 8);
export const itemTarget = (itemTitle: string, planId: string) => `${itemTitle} in plan ${planTarget(planId)}`;
