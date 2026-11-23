// Attempt-level (L5) state for the TUI, pure so node tests cover it: live tail, CI and
// "live detail unavailable" per item, and the step-by-step pending-input answer flow.
// The state rules are ported from apps/bob/src/components/sdlc/attempt-model.ts
// (the web module is not importable from Node without bundling it).
import {
  decodeAnswers,
  encodeAnswers,
  TAIL_LIMITS,
  type Answers,
  type AttemptMessage,
  type CiMessage,
  type CommandOption,
  type ItemSnapshot,
  type PendingInput,
  type PendingQuestion,
  type TailFrame,
  type WatchMessage,
} from "@bob/sdlc-view";

export interface AttemptState {
  /** The item this session watches; re-sent on every new socket. */
  watching: string | null;
  tails: Record<string, TailFrame>;
  ci: Record<string, CiMessage>;
  unavailable: Record<string, string>;
}

export const emptyAttempt = (): AttemptState => ({ watching: null, tails: {}, ci: {}, unavailable: {} });
export const MAX_ATTEMPT_ITEMS = 20;
export const watchMessage = (itemId: string | null): WatchMessage => ({ type: "watch", itemId });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** One already-parsed socket message as an attempt message, else null. */
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

/** A tail frame replaces the item's last (unless older, same attempt) and clears unavailable; tailUnavailable keeps the last tail. */
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

export type TailView =
  | { kind: "waiting" }
  | { kind: "unavailable"; reason: string; frame: TailFrame | null }
  | { kind: "live"; frame: TailFrame };

export function tailView(state: AttemptState, item: ItemSnapshot): TailView {
  const frame = state.tails[item.itemId];
  const current = frame && (!item.execution || frame.attemptId === item.execution.attemptId) ? frame : null;
  const reason = state.unavailable[item.itemId];
  if (reason !== undefined) return { kind: "unavailable", reason, frame: current };
  return current ? { kind: "live", frame: current } : { kind: "waiting" };
}

/** The last `n` lines that fit (never more than the protocol's 40). */
export const tailLines = (frame: TailFrame | null | undefined, n: number): string[] =>
  frame ? frame.lines.slice(-Math.max(0, Math.min(n, TAIL_LIMITS.maxLines))) : [];

// ── Pending input ────────────────────────────────────────────────────────────

export const optionValue = (o: PendingQuestion["options"][number]) => o.value ?? o.label;
export interface QuestionDraft { selected: string[]; text: string }
export type AnswerDraft = Record<string, QuestionDraft>;
export const MAX_ANSWER_CHARS = 4000;

export const emptyDraft = (pending: PendingInput): AnswerDraft =>
  Object.fromEntries(pending.questions.map((q) => [q.id, { selected: [], text: "" }]));

const draftOf = (draft: AnswerDraft, id: string): QuestionDraft => draft[id] ?? { selected: [], text: "" };

export function toggleOption(draft: AnswerDraft, question: PendingQuestion, value: string): AnswerDraft {
  const d = draftOf(draft, question.id);
  const selected = question.multiSelect
    ? d.selected.includes(value) ? d.selected.filter((v) => v !== value) : [...d.selected, value]
    : [value];
  return { ...draft, [question.id]: { ...d, selected } };
}

export const setText = (draft: AnswerDraft, question: PendingQuestion, text: string): AnswerDraft =>
  ({ ...draft, [question.id]: { ...draftOf(draft, question.id), text } });

/** One question's answer or an error, mirroring decodeAnswers. */
export function questionAnswer(question: PendingQuestion, d: QuestionDraft | undefined): { answer: string | string[] } | { error: string } {
  const draft = d ?? { selected: [], text: "" };
  if (question.options.length === 0) {
    const text = draft.text.trim();
    if (!text) return { error: "Type an answer." };
    if (text.length > MAX_ANSWER_CHARS) return { error: `Keep it under ${MAX_ANSWER_CHARS} characters.` };
    return { answer: text };
  }
  const allowed = new Set(question.options.map(optionValue));
  const selected = draft.selected.filter((v) => allowed.has(v) && v.length > 0);
  if (selected.length === 0) return { error: question.multiSelect ? "Pick at least one option (space toggles)." : "Pick an option." };
  return { answer: question.multiSelect ? selected : selected[0]! };
}

/** The Answers for a draft, or null with the first error. Final check is decodeAnswers itself. */
export function draftAnswers(pending: PendingInput, draft: AnswerDraft): { answers: Answers | null; error: string | null } {
  const answers: Answers = {};
  for (const q of pending.questions) {
    const r = questionAnswer(q, draft[q.id]);
    if ("error" in r) return { answers: null, error: `${q.header ?? q.question}: ${r.error}` };
    answers[q.id] = r.answer;
  }
  return decodeAnswers(encodeAnswers(answers), pending) ? { answers, error: null } : { answers: null, error: "The answer is not valid for these questions." };
}

export const answerablePending = (item: ItemSnapshot | null | undefined): PendingInput | null =>
  item && item.state === "waiting-input" && item.pendingInput && item.pendingInput.questions.length > 0 ? item.pendingInput : null;

/** The ResolveInput option (tier 1) for answers. */
export const resolveInputOption = (itemId: string, pending: PendingInput, answers: Answers): CommandOption => ({
  label: "Answer",
  tier: 1,
  command: { operation: "ResolveInput", input: { itemId, attemptId: pending.attemptId, promptId: pending.promptId, answer: encodeAnswers(answers) } },
});

// ── The answer flow: one question at a time ──────────────────────────────────

export interface AnswerFlow {
  itemId: string;
  /** "BOB-12": names the item in prompts and the command label. */
  target: string;
  pending: PendingInput;
  step: number;
  /** The highlighted option of the current question. */
  cursor: number;
  draft: AnswerDraft;
  error: string | null;
}

export const startFlow = (itemId: string, target: string, pending: PendingInput): AnswerFlow =>
  ({ itemId, target, pending, step: 0, cursor: 0, draft: emptyDraft(pending), error: null });

export const currentQuestion = (flow: AnswerFlow): PendingQuestion => flow.pending.questions[flow.step]!;

export interface FlowKey { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; tab?: boolean; shift?: boolean; leftArrow?: boolean }

export type FlowResult =
  | { kind: "continue"; flow: AnswerFlow }
  | { kind: "cancel" }
  | { kind: "submit"; flow: AnswerFlow; answers: Answers };

const go = (flow: AnswerFlow): FlowResult => ({ kind: "continue", flow });

function advance(flow: AnswerFlow): FlowResult {
  const q = currentQuestion(flow);
  const r = questionAnswer(q, flow.draft[q.id]);
  if ("error" in r) return go({ ...flow, error: r.error });
  if (flow.step < flow.pending.questions.length - 1) return go({ ...flow, step: flow.step + 1, cursor: 0, error: null });
  const { answers, error } = draftAnswers(flow.pending, flow.draft);
  return answers ? { kind: "submit", flow: { ...flow, error: null }, answers } : go({ ...flow, error });
}

/**
 * One key in the answer flow. Options: ↑↓/j k move, space picks (toggles for multiSelect),
 * enter picks the highlighted option of a single choice and moves on. Free text: type,
 * backspace, enter moves on. shift-tab goes back a question; esc cancels. Enter on the last
 * question submits once every answer is valid.
 */
export function flowKey(flow: AnswerFlow, input: string, key: FlowKey): FlowResult {
  if (key.escape) return { kind: "cancel" };
  if ((key.tab && key.shift) || (key.leftArrow && currentQuestion(flow).options.length > 0)) {
    return go({ ...flow, step: Math.max(0, flow.step - 1), cursor: 0, error: null });
  }
  const q = currentQuestion(flow);
  if (q.options.length > 0) {
    const n = q.options.length;
    if (key.upArrow || input === "k") return go({ ...flow, cursor: Math.max(0, flow.cursor - 1) });
    if (key.downArrow || input === "j") return go({ ...flow, cursor: Math.min(n - 1, flow.cursor + 1) });
    const value = optionValue(q.options[flow.cursor]!);
    if (input === " ") return go({ ...flow, draft: toggleOption(flow.draft, q, value), error: null });
    const digit = Number(input);
    if (Number.isInteger(digit) && digit >= 1 && digit <= n) return go({ ...flow, cursor: digit - 1, draft: toggleOption(flow.draft, q, optionValue(q.options[digit - 1]!)), error: null });
    if (key.return) {
      // A single choice takes the highlighted option on enter.
      const draft = q.multiSelect ? flow.draft : toggleOption(flow.draft, q, value);
      return advance({ ...flow, draft });
    }
    return go(flow);
  }
  const text = flow.draft[q.id]?.text ?? "";
  if (key.return) return advance(flow);
  if (key.backspace || key.delete) return go({ ...flow, draft: setText(flow.draft, q, text.slice(0, -1)), error: null });
  if (input && !key.ctrl && !key.tab && text.length < MAX_ANSWER_CHARS) return go({ ...flow, draft: setText(flow.draft, q, (text + input).slice(0, MAX_ANSWER_CHARS)), error: null });
  return go(flow);
}
