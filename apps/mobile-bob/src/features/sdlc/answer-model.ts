// The answer sheet for an item waiting for input (BOB-80): one draft per pending prompt,
// option toggles for single and multi select, free text for questions without options.
// The edge and the coordinator validate the encoded answer with decodeAnswers from
// @bob/sdlc-view; this runs the same function (not a copy), so the send button is only
// live when the answer will be accepted: every question answered, and an option question
// answered only with its option values (value ?? label).
import { decodeAnswers, encodeAnswers, stripTerminalControls } from "@bob/sdlc-view";
import type {Answers, CommandInput, PendingInput, PendingQuestion} from "@bob/sdlc-view";

export const MAX_ANSWER_CHARS = 4000;

/** Per question: the selected option values, or the free text. */
export type AnswerDraft = Record<string, { selected: string[]; text: string }>;

export const optionValue = (option: PendingQuestion["options"][number]) => option.value ?? option.label;

/** Agent-sourced text made safe to show: no terminal escapes or control characters. */
export const agentText = (text: string, multiline = false) => stripTerminalControls(text, { multiline });

/**
 * The prompt as shown: question, header and option label/description stripped of terminal
 * controls. Option values are left as they are, because the answer must carry them exactly.
 */
export function displayPending(pending: PendingInput): PendingInput {
  return {
    ...pending,
    questions: pending.questions.map((q) => ({
      ...q,
      question: agentText(q.question, true),
      ...(q.header === undefined ? {} : { header: agentText(q.header) }),
      options: q.options.map((o) => ({
        ...o,
        label: agentText(o.label),
        ...(o.description === undefined ? {} : { description: agentText(o.description) }),
      })),
    })),
  };
}

export function emptyDraft(pending: PendingInput): AnswerDraft {
  return Object.fromEntries(pending.questions.map((q) => [q.id, { selected: [], text: "" }]));
}

/** Tapping an option: single select replaces, multi select toggles. */
export function toggleOption(draft: AnswerDraft, question: PendingQuestion, value: string): AnswerDraft {
  const current = draft[question.id] ?? { selected: [], text: "" };
  const selected = question.multiSelect
    ? current.selected.includes(value)
      ? current.selected.filter((v) => v !== value)
      : [...current.selected, value]
    : current.selected.length === 1 && current.selected[0] === value
      ? []
      : [value];
  return { ...draft, [question.id]: { ...current, selected } };
}

export function setText(draft: AnswerDraft, questionId: string, text: string): AnswerDraft {
  const current = draft[questionId] ?? { selected: [], text: "" };
  return { ...draft, [questionId]: { ...current, text } };
}

/**
 * The answers object, or null while any question is unanswered. A question with
 * options takes its selections; one without takes its trimmed free text.
 */
export function answersFrom(pending: PendingInput, draft: AnswerDraft): Answers | null {
  const answers: Answers = {};
  for (const q of pending.questions) {
    const d = draft[q.id] ?? { selected: [], text: "" };
    if (q.options.length > 0) {
      const [chosen] = d.selected;
      if (chosen === undefined) return null;
      answers[q.id] = q.multiSelect ? d.selected : chosen;
    } else {
      const text = d.text.trim();
      if (!text || text.length > MAX_ANSWER_CHARS) return null;
      answers[q.id] = text;
    }
  }
  return decodeAnswers(encodeAnswers(answers), pending) ? answers : null;
}

/** The tier 1 ResolveInput command for a complete draft, else null. */
export function resolveCommand(itemId: string, pending: PendingInput, draft: AnswerDraft): CommandInput | null {
  const answers = answersFrom(pending, draft);
  if (!answers) return null;
  return {
    operation: "ResolveInput",
    input: { itemId, attemptId: pending.attemptId, promptId: pending.promptId, answer: encodeAnswers(answers) },
  };
}

export function unansweredCount(pending: PendingInput, draft: AnswerDraft): number {
  return pending.questions.filter((q) => {
    const d = draft[q.id];
    if (!d) return true;
    return q.options.length > 0 ? d.selected.length === 0 : d.text.trim().length === 0;
  }).length;
}
