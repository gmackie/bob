import { createHash } from 'node:crypto';

/** Port of decodeAnswers in packages/bob/src/sdlc-view/src/attempt.ts (BOB-80).
 * Parses an encoded answer (JSON {questionId: string | string[]}) and validates it
 * against the pending questions: every question answered, no unknown ids, values
 * non-empty strings of at most 4000 characters, an array only for multiSelect.
 * Returns the answers, or null when invalid. */
export function decodeAnswers(encoded, pending) {
  let raw;
  try { raw = JSON.parse(encoded); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const ids = new Set(pending.questions.map(q => q.id));
  if (Object.keys(raw).some(key => !ids.has(key))) return null;
  for (const q of pending.questions) {
    const answer = raw[q.id];
    if (answer === undefined) return null;
    const values = Array.isArray(answer) ? answer : [answer];
    if (values.length === 0 || values.some(v => typeof v !== 'string' || v.length === 0 || v.length > 4000)) return null;
    if (!q.multiSelect && Array.isArray(answer)) return null;
  }
  return raw;
}

/** The answers in the shape t3 clients send (t3 ws spec §3.4): a string for a
 * single-select or free-text question, an array of strings for multiSelect. */
export function t3Answers(answers, pending) {
  return Object.fromEntries(pending.questions.map(q => {
    const answer = answers[q.id];
    return [q.id, q.multiSelect && !Array.isArray(answer) ? [answer] : answer];
  }));
}

/** t3 commandId for runtime-request.respond: stable per attempt and prompt, so a
 * retried delivery is the same command on the t3 side. */
export const inputCommandId = (attemptId, promptId) => 'bob-input-' + createHash('sha256').update(JSON.stringify([attemptId, promptId])).digest('hex').slice(0, 40);
