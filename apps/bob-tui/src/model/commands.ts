// The TUI's command lifecycle: pending → accepted → succeeded | failed, or rejected.
// Pure, so node tests cover it; client/session.ts feeds it from the socket.
import {
  COMMAND_LIMITS,
  type ClientCommand,
  type CommandInput,
  type CommandOption,
  type CommandStatusMessage,
  type Confirmation,
  type CoordinatorOperation,
} from "@bob/sdlc-view";

export type CommandStatus = "pending" | "accepted" | "succeeded" | "failed" | "rejected" | "expired";

export interface CommandEntry {
  /** The exact message sent; a resend after a reconnect reuses it, commandId included. */
  command: ClientCommand;
  label: string;
  resourceId: string;
  status: CommandStatus;
  sentAt: number;
  error?: string;
  /** The reject or failure code, when there is one ("expired" for an expiry). */
  errorCode?: string;
  operation?: CoordinatorOperation;
}

export interface CommandsState {
  entries: Record<string, CommandEntry>;
  /** commandIds, oldest first. */
  order: string[];
}

export const MAX_KEPT = 30;
export const emptyCommands = (): CommandsState => ({ entries: {}, order: [] });

export const resourceIdOf = (command: CommandInput): string =>
  command.operation === "ControlPlan" ? command.input.planId : command.input.itemId;

export const isInFlight = (entry: CommandEntry) => entry.status === "pending" || entry.status === "accepted";
/**
 * An expiry (the edge's synthetic one, or this client's own) is not final for results:
 * the coordinator may still have run the command, and a late real commandResult replaces it.
 */
export const isExpiry = (entry: CommandEntry) => entry.status === "expired" || (entry.status === "failed" && entry.errorCode === "expired");

/** Plain words for reject and failure codes; anything else shows as `code: message`. */
const FRIENDLY: Record<string, string> = {
  conflict: "this command id was already used for a different action; start the action again",
  "outbox-full": "too many commands are queued; wait for some to finish",
  "rate-limited": "too many commands in the last minute; wait a moment",
  "coordinator-offline": "the coordinator is offline; try again once it is back",
  forbidden: "you are not allowed to run SDLC commands",
  expired: "the coordinator did not pick it up in time",
  InternalError: "the coordinator could not run it; it will retry",
};
export const errorText = (code: string, message: string) => FRIENDLY[code] ?? `${code}: ${message}`;

const STATUS_TYPES = new Set(["commandAccepted", "commandRejected", "commandResult"]);

/** A parsed socket message that is a command status, else null. */
export function asCommandStatus(value: unknown): CommandStatusMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (!STATUS_TYPES.has(message.type as string) || typeof message.commandId !== "string") return null;
  if (message.type === "commandResult" && typeof message.ok !== "boolean") return null;
  return message as unknown as CommandStatusMessage;
}

/** The ClientCommand for an option and its confirmation. */
export const clientCommand = (commandId: string, option: CommandOption, confirm?: Confirmation): ClientCommand =>
  ({ type: "command", commandId, ...option.command, ...(confirm ? { confirm } : {}) }) as ClientCommand;

export function recordSent(state: CommandsState, command: ClientCommand, label: string, now: number): CommandsState {
  if (state.entries[command.commandId]) return state;
  const entry: CommandEntry = { command, label, resourceId: resourceIdOf(command), status: "pending", sentAt: now };
  return trim({ entries: { ...state.entries, [command.commandId]: entry }, order: [...state.order, command.commandId] });
}

/**
 * Folds a status message in. Statuses for commands this client did not send (the edge
 * broadcasts results to every viewer) are ignored, and a final status is never overwritten,
 * except that a real commandResult replaces an expiry (isExpiry).
 */
export function applyStatus(state: CommandsState, message: CommandStatusMessage): CommandsState {
  const current = state.entries[message.commandId];
  if (!current) return state;
  if (!isInFlight(current) && !(isExpiry(current) && message.type === "commandResult")) return state;
  let next: CommandEntry;
  if (message.type === "commandAccepted") next = { ...current, status: "accepted" };
  else if (message.type === "commandRejected") next = { ...current, status: "rejected", errorCode: message.code, error: errorText(message.code, message.message) };
  else if (!message.ok) {
    if (current.status === "expired" && message.error.code === "expired") return state; // already shown as expired
    next = { ...current, status: "failed", errorCode: message.error.code, error: errorText(message.error.code, message.error.message) };
  } else if (message.operation.state === "failed" || message.operation.state === "cancelled") {
    const e = message.operation.error;
    next = { ...current, status: "failed", operation: message.operation, errorCode: e?.code ?? message.operation.state, error: e ? errorText(e.code, e.message) : `operation ${message.operation.state}` };
  } else next = { ...current, status: "succeeded", operation: message.operation, errorCode: undefined, error: undefined };
  return { ...state, entries: { ...state.entries, [message.commandId]: next } };
}

/** In-flight commands older than the edge's outbox expiry will never get a result. */
export function expire(state: CommandsState, now: number): CommandsState {
  let changed = false;
  const entries = { ...state.entries };
  for (const id of state.order) {
    const e = entries[id]!;
    if (isInFlight(e) && now - e.sentAt > COMMAND_LIMITS.expireAfterMs) {
      entries[id] = { ...e, status: "expired", errorCode: "expired", error: "no result from the coordinator" };
      changed = true;
    }
  }
  return changed ? { ...state, entries } : state;
}

/** What to send again on a new socket, with the original commandId; the edge and coordinator dedupe it. */
export const toResend = (state: CommandsState): ClientCommand[] =>
  state.order.map((id) => state.entries[id]!).filter(isInFlight).map((e) => e.command);

export function latestFor(state: CommandsState, resourceId: string): CommandEntry | null {
  for (let i = state.order.length - 1; i >= 0; i--) {
    const e = state.entries[state.order[i]!]!;
    if (e.resourceId === resourceId) return e;
  }
  return null;
}

export const recent = (state: CommandsState, n: number): CommandEntry[] =>
  state.order.slice(-n).map((id) => state.entries[id]!);

export function statusText(entry: CommandEntry): string {
  switch (entry.status) {
    case "pending": return `${entry.label}: pending`;
    case "accepted": return `${entry.label}: accepted, waiting for the coordinator`;
    case "succeeded": {
      const op = entry.operation;
      if (!op) return `${entry.label}: done`;
      // "accepted" is the coordinator taking the command on (a cancel still settling), not success.
      return `${entry.label}: ${op.state === "accepted" ? "accepted by the coordinator" : op.state} (v${op.resourceVersion})`;
    }
    case "rejected": return `${entry.label}: rejected (${entry.error})`;
    case "failed": return `${entry.label}: failed (${entry.error})`;
    case "expired": return `${entry.label}: expired (${entry.error})`;
  }
}

function trim(state: CommandsState): CommandsState {
  if (state.order.length <= MAX_KEPT) return state;
  const drop = state.order.filter((id) => !isInFlight(state.entries[id]!)).slice(0, state.order.length - MAX_KEPT);
  if (!drop.length) return state;
  const gone = new Set(drop);
  const entries = { ...state.entries };
  for (const id of gone) delete entries[id];
  return { entries, order: state.order.filter((id) => !gone.has(id)) };
}
