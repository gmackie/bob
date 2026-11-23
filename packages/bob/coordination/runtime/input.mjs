import { createHash } from 'node:crypto';

/** Port of decodeAnswers in packages/bob/src/sdlc-view/src/attempt.ts (BOB-80).
 * Parses an encoded answer (JSON {questionId: string | string[]}) and validates it
 * against the pending questions: every question answered, no unknown ids, values
 * non-empty strings of at most 4000 characters, an array only for multiSelect, and for
 * a question with options every value one of its option values (value ?? label).
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
    if (q.options?.length) {
      const allowed = new Set(q.options.map(o => o.value ?? o.label));
      if (values.some(v => !allowed.has(v))) return null;
    }
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

/** t3 commandId for runtime-request.respond: stable per delivery (attempt, prompt and the
 * ResolveInput commandId), so a retried delivery is the same command on the t3 side while
 * a new answer after an abandoned delivery is a new command. */
export const inputCommandId = (attemptId, promptId, commandId) => 'bob-input-' + createHash('sha256').update(JSON.stringify([attemptId, promptId, commandId])).digest('hex').slice(0, 40);

/** Whether t3's recorded answers (a resolved runtime request) are ours: every key we sent
 * is present with our value, or with the label of the option our value names (the
 * runtime request does not record the t3 commandId, t3 ws spec §3.3). Extra keys are
 * ignored. `questions` are the pending questions (may be empty: then exact values only). */
export function answersMatch(recorded, ours, questions = []) {
  if (typeof recorded !== 'object' || recorded === null || Array.isArray(recorded)) return false;
  const byId = new Map(questions.map(q => [q?.id, q]));
  const same = (theirs, mine, q) => {
    if (theirs === mine) return true;
    const option = (q?.options ?? []).find(o => (o?.value ?? o?.label) === mine);
    return option !== undefined && theirs === option.label;
  };
  return Object.entries(ours).every(([id, mine]) => {
    if (!Object.hasOwn(recorded, id)) return false;
    const theirs = recorded[id], q = byId.get(id);
    if (Array.isArray(mine)) {
      const list = Array.isArray(theirs) ? theirs : [theirs];
      return list.length === mine.length && mine.every((v, i) => same(list[i], v, q));
    }
    return same(Array.isArray(theirs) && theirs.length === 1 ? theirs[0] : theirs, mine, q);
  });
}
