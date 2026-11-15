// The SDLC command lifecycle and action availability on the phone, without a socket
// or React, so node tests cover it. Ported from apps/bob/src/components/sdlc/commands-model.ts
// (web code is not importable here); keep the two in step.
import type {
  ClientCommand,
  CommandInput,
  CommandOption,
  CommandStatusMessage,
  CoordinatorOperation,
} from "@bob/sdlc-view";

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
/** The edge's synthetic expiry is not final: a late real commandResult replaces it. */
export const isExpiry = (entry: CommandEntry) => entry.status === "failed" && entry.errorCode === "expired";

const STATUS_TYPES = new Set(["commandAccepted", "commandRejected", "commandResult"]);

/** One already-parsed socket message as a command status message, else null. */
export function asCommandStatus(value: unknown): CommandStatusMessage | null {
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
  "rate-limited": "Too many commands in the last minute. Wait a moment, then try again.",
  expired: "The coordinator did not pick this command up in time, so it was dropped. Try again.",
  conflict: "This command's id was already used for a different action. Start the action again.",
  InternalError: "The coordinator could not run this command. It will retry; if this persists, try again later.",
  VersionConflict: "Someone else changed this first. The view has the latest state; check it and try again.",
};

export function friendlyError(code: string, message: string): string {
  return FRIENDLY[code] ?? (message || code);
}

export type CommandEvent = { type: "sent"; command: ClientCommand; label: string } | CommandStatusMessage;

function trim(state: CommandsState): CommandsState {
  const finished = state.order.filter((id) => {
    const entry = state.entries[id];
    return !!entry && !isInFlight(entry);
  });
  if (finished.length <= MAX_FINISHED) return state;
  const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED));
  const entries = { ...state.entries };
  for (const id of drop) delete entries[id];
  return { entries, order: state.order.filter((id) => !drop.has(id)) };
}

/**
 * Folds a send or a status message into the command state. Statuses for commandIds
 * this client did not send are ignored; a final status is never overwritten, except
 * that a real commandResult replaces an expiry.
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
          ...current,
          status: "failed",
          operation: event.operation,
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

/** Everything not yet final, with the original commandId: the edge dedupes, the coordinator replays. */
export const commandsToResend = (state: CommandsState): ClientCommand[] =>
  state.order.flatMap((id) => {
    const entry = state.entries[id];
    return entry && isInFlight(entry) ? [entry.command] : [];
  });

export function latestFor(state: CommandsState, resourceId: string): CommandEntry | null {
  for (let i = state.order.length - 1; i >= 0; i--) {
    const entry = state.entries[state.order[i] ?? ""];
    if (entry?.resourceId === resourceId) return entry;
  }
  return null;
}

export function outcomeText(entry: CommandEntry): string {
  switch (entry.status) {
    case "pending":
      return `${entry.label}: sending…`;
    case "accepted":
      return `${entry.label}: queued for the coordinator…`;
    case "rejected":
    case "failed":
      return `${entry.label} failed: ${entry.error ?? "unknown error"}`;
    case "succeeded": {
      const op = entry.operation;
      if (!op) return `${entry.label}: done`;
      const state = op.state === "accepted" ? "accepted by the coordinator" : op.state;
      return `${entry.label}: ${state} (now v${op.resourceVersion})`;
    }
  }
}

// ── Availability ─────────────────────────────────────────────────────────────

export type EdgeConnection = "connecting" | "live" | "reconnecting" | "auth-failed";

export type Banner =
  | { kind: "connecting" | "reconnecting" }
  | { kind: "auth-failed"; message: string }
  | { kind: "coordinator-offline"; since: number | null };

export interface ActionContext {
  connection: EdgeConnection;
  banner: Banner | null;
  hasView: boolean;
  commands: CommandsState;
}

export interface ActionButton {
  option: CommandOption;
  key: string;
  disabled: boolean;
  reason: string | null;
  pending: boolean;
}

export function globalDisabledReason(ctx: Omit<ActionContext, "commands">): string | null {
  if (ctx.connection !== "live") return "Not connected to the SDLC edge.";
  if (!ctx.hasView) return "Waiting for the first snapshot.";
  if (ctx.banner?.kind === "coordinator-offline") return "The coordinator is offline; actions resume when it is back.";
  return null;
}

const keyOf = (option: CommandOption) =>
  option.command.operation === "ControlPlan" ? `ControlPlan:${option.command.input.action}` : option.command.operation;

export function actionButtons(options: CommandOption[], ctx: ActionContext): ActionButton[] {
  const global = globalDisabledReason(ctx);
  return options.map((option) => {
    const latest = latestFor(ctx.commands, resourceIdOf(option.command));
    const inFlight = latest && isInFlight(latest) ? latest : null;
    const pending = inFlight !== null;
    const reason = global ?? (inFlight ? `Waiting for "${inFlight.label}" to finish.` : null);
    return { option, key: keyOf(option), disabled: reason !== null, reason, pending };
  });
}
