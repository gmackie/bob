// Attempt-level (L5) state for /sdlc without a socket or React, so node tests cover it:
// the live tail, CI phases and "live detail unavailable" per item, the watch message,
// and the pending-input answer form. edge-client.ts feeds it; attempt-*.tsx draw it.
import {
  decodeAnswers,
  encodeAnswers,
  TAIL_LIMITS,
  type Answers,
  type AttemptMessage,
  type CiMessage,
  type CommandInput,
  type ItemSnapshot,
  type PendingInput,
  type PendingQuestion,
  type TailFrame,
  type WatchMessage,
} from "@bob/sdlc-view";

export interface AttemptState {
  /** The item this client asked the edge to watch, re-sent on every new socket. */
  watching: string | null;
  /** The latest tail frame per item. */
  tails: Record<string, TailFrame>;
  /** The latest CI detail per item. */
  ci: Record<string, CiMessage>;
  /** Why live detail is unavailable, per item; cleared by the next tail frame for it. */
  unavailable: Record<string, string>;
}

export const emptyAttempt = (): AttemptState => ({ watching: null, tails: {}, ci: {}, unavailable: {} });

/** Items whose tail/CI detail is kept; the oldest beyond this are dropped. */
export const MAX_ATTEMPT_ITEMS = 20;

export const watchMessage = (itemId: string | null): WatchMessage => ({ type: "watch", itemId });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** Parses one socket message; anything that is not an attempt message is null. */
export function parseAttemptMessage(data: unknown): AttemptMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try { value = JSON.parse(data); } catch { return null; }
  return asAttemptMessage(value);
}

/** One already-parsed value as an attempt message, else null. */
export function asAttemptMessage(value: unknown): AttemptMessage | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "tail": {
      const f = value.frame;
      if (!isRecord(f) || !isStr(f.itemId) || !isStr(f.attemptId) || !isStr(f.threadId) || !Array.isArray(f.lines) || !f.lines.every(isStr)) return null;
      return value as unknown as AttemptMessage;
    }
    case "ci":
      if (!isStr(value.itemId) || typeof value.available !== "boolean") return null;
      if (value.available ? !Array.isArray(value.phases) : !isStr(value.reason)) return null;
      return value as unknown as AttemptMessage;
    case "tailUnavailable":
      return isStr(value.itemId) && isStr(value.reason) ? (value as unknown as AttemptMessage) : null;
    default:
      return null;
  }
}

function bounded<T>(record: Record<string, T>, keep: string): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.length <= MAX_ATTEMPT_ITEMS) return record;
  const out = { ...record };
  for (const k of keys) {
    if (Object.keys(out).length <= MAX_ATTEMPT_ITEMS) break;
    if (k !== keep) delete out[k];
  }
  return out;
}

/**
 * Folds an attempt message in. A tail frame replaces the item's previous one (frames carry
 * the whole tail) unless it is older than what is kept for the same attempt, and clears the
 * item's unavailable marker. tailUnavailable keeps the last tail, marked unavailable.
 */
export function reduceAttempt(state: AttemptState, message: AttemptMessage): AttemptState {
  switch (message.type) {
    case "tail": {
      const frame = message.frame;
      const current = state.tails[frame.itemId];
      if (current && current.attemptId === frame.attemptId && current.at > frame.at) return state;
      const { [frame.itemId]: _gone, ...unavailable } = state.unavailable;
      return { ...state, tails: bounded({ ...state.tails, [frame.itemId]: frame }, frame.itemId), unavailable };
    }
    case "ci":
      return { ...state, ci: bounded({ ...state.ci, [message.itemId]: message }, message.itemId) };
    case "tailUnavailable":
      return { ...state, unavailable: bounded({ ...state.unavailable, [message.itemId]: message.reason }, message.itemId) };
  }
}

/** The last `n` lines of a frame (never more than the protocol's 40). */
export const tailLines = (frame: TailFrame | undefined, n: number = TAIL_LIMITS.maxLines): string[] =>
  frame ? frame.lines.slice(-Math.max(0, Math.min(n, TAIL_LIMITS.maxLines))) : [];

/** What the attempt view shows for an item's live detail. */
export type TailView =
  | { kind: "waiting" }
  | { kind: "unavailable"; reason: string; frame: TailFrame | null }
  | { kind: "live"; frame: TailFrame };

export function tailView(state: AttemptState, item: ItemSnapshot): TailView {
  const frame = state.tails[item.itemId];
  // A frame from an earlier attempt is not this attempt's tail.
  const current = frame && (!item.execution || frame.attemptId === item.execution.attemptId) ? frame : null;
  const reason = state.unavailable[item.itemId];
  if (reason !== undefined) return { kind: "unavailable", reason, frame: current };
  return current ? { kind: "live", frame: current } : { kind: "waiting" };
}

// ── Pending input ────────────────────────────────────────────────────────────

/** An option's answer value: its value, else its label. */
export const optionValue = (o: PendingQuestion["options"][number]) => o.value ?? o.label;

export interface QuestionDraft { selected: string[]; text: string }
export type AnswerDraft = Record<string, QuestionDraft>;

export const MAX_ANSWER_CHARS = 4000;

export const emptyDraft = (pending: PendingInput): AnswerDraft =>
  Object.fromEntries(pending.questions.map((q) => [q.id, { selected: [], text: "" }]));

const draftOf = (draft: AnswerDraft, id: string): QuestionDraft => draft[id] ?? { selected: [], text: "" };

/** Picks an option: single-select replaces, multiSelect toggles. */
export function toggleOption(draft: AnswerDraft, question: PendingQuestion, value: string): AnswerDraft {
  const d = draftOf(draft, question.id);
  const selected = question.multiSelect
    ? d.selected.includes(value) ? d.selected.filter((v) => v !== value) : [...d.selected, value]
    : [value];
  return { ...draft, [question.id]: { ...d, selected } };
}

export const setText = (draft: AnswerDraft, question: PendingQuestion, text: string): AnswerDraft =>
  ({ ...draft, [question.id]: { ...draftOf(draft, question.id), text } });

/** One question's answer from the draft, or an error. Mirrors decodeAnswers. */
export function questionAnswer(question: PendingQuestion, d: QuestionDraft | undefined): { answer: string | string[] } | { error: string } {
  const draft = d ?? { selected: [], text: "" };
  if (question.options.length === 0) {
    const text = draft.text.trim();
    if (!text) return { error: "Write an answer." };
    if (text.length > MAX_ANSWER_CHARS) return { error: `Keep it under ${MAX_ANSWER_CHARS} characters.` };
    return { answer: text };
  }
  const allowed = new Set(question.options.map(optionValue));
  const selected = draft.selected.filter((v) => allowed.has(v) && v.length > 0);
  if (selected.length === 0) return { error: question.multiSelect ? "Pick at least one option." : "Pick an option." };
  return { answer: question.multiSelect ? selected : selected[0]! };
}

export interface DraftResult {
  /** Null while any question is unanswered or invalid. */
  answers: Answers | null;
  errors: Record<string, string>;
}

/** The Answers for a draft, validated the way the coordinator validates them (decodeAnswers). */
export function draftAnswers(pending: PendingInput, draft: AnswerDraft): DraftResult {
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  for (const q of pending.questions) {
    const r = questionAnswer(q, draft[q.id]);
    if ("error" in r) errors[q.id] = r.error;
    else answers[q.id] = r.answer;
  }
  if (Object.keys(errors).length) return { answers: null, errors };
  // The coordinator runs decodeAnswers on what we send; refuse anything it would refuse.
  return decodeAnswers(encodeAnswers(answers), pending) ? { answers, errors } : { answers: null, errors: { _: "The answer is not valid for these questions." } };
}

/** The ResolveInput command for an item's pending input. */
export const resolveInputCommand = (itemId: string, pending: PendingInput, answers: Answers): CommandInput =>
  ({ operation: "ResolveInput", input: { itemId, attemptId: pending.attemptId, promptId: pending.promptId, answer: encodeAnswers(answers) } });

/** The pending input to answer: only while the item is waiting for input. */
export const answerablePending = (item: ItemSnapshot): PendingInput | null =>
  item.state === "waiting-input" && item.pendingInput && item.pendingInput.questions.length > 0 ? item.pendingInput : null;

// ── CI ───────────────────────────────────────────────────────────────────────

export const CI_STATUS_MARK: Record<string, string> = {
  queued: "○", running: "◐", passed: "✓", failed: "✗", skipped: "–", unknown: "?",
};
