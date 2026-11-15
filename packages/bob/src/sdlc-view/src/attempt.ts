/**
 * Attempt-level protocol (BOB-80, BOB-75 Phase 3). Shared by the coordinator's
 * tail relay (packages/bob/coordination/runtime/tail.mjs, by shape), the
 * SdlcEdge DO and every surface.
 *
 * Pending input:
 *   t3 thread shell: pendingRuntimeRequest {kind:"user_input"} + a user_input_request
 *   thread item with questions → relay calls the coordinator's internal
 *   RecordPendingInput → item state waiting-input with ItemSnapshot.pendingInput.
 *   A surface answers with the relayed command ResolveInput (tier 1) whose
 *   `answer` is encodeAnswers(...). The coordinator validates it against
 *   pendingInput, records a receipt, moves the item back to running, and the relay
 *   sends t3 `runtime-request.respond` with the decoded answers.
 *
 * Live tail (ephemeral, never stored by the edge):
 *   relay --POST /api/sdlc/tail (same bearer as ingest) TailFrame[]--> DO
 *   DO --ws TailMessage--> only sockets that sent WatchMessage for that item.
 *
 * CI detail (display only):
 *   DO polls ForgeGraph for watched items --ws CiMessage--> watching sockets.
 */

export interface PendingQuestion {
  /** t3 question id; key in the answers object. */
  id: string;
  header?: string;
  question: string;
  options: Array<{ label: string; value?: string; description?: string }>;
  multiSelect: boolean;
}

export interface PendingInput {
  attemptId: string;
  /** t3 runtime request id. */
  promptId: string;
  kind: "user_input";
  questions: PendingQuestion[];
  createdAt: string;
}

/** {questionId: answer or answers}. Free text is allowed when a question has no options. */
export type Answers = Record<string, string | string[]>;

export const encodeAnswers = (answers: Answers): string => JSON.stringify(answers);

/** Parses and validates an encoded answer against the pending questions. Null when invalid. */
export function decodeAnswers(encoded: string, pending: PendingInput): Answers | null {
  let raw: unknown;
  try { raw = JSON.parse(encoded); } catch { return null; }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const answers = raw as Record<string, unknown>;
  const ids = new Set(pending.questions.map(q => q.id));
  if (Object.keys(answers).some(k => !ids.has(k))) return null;
  for (const q of pending.questions) {
    const a = answers[q.id];
    if (a === undefined) return null;
    const values = Array.isArray(a) ? a : [a];
    if (values.length === 0 || values.some(v => typeof v !== "string" || v.length === 0 || v.length > 4000)) return null;
    if (!q.multiSelect && Array.isArray(a)) return null;
  }
  return answers as Answers;
}

/** One relay update for one running attempt. `lines` replaces the previous tail (max 40 lines, 200 chars each). */
export interface TailFrame {
  itemId: string;
  attemptId: string;
  threadId: string;
  lines: string[];
  /** t3 thread status, e.g. running, waiting, completed. */
  threadStatus: string;
  at: string;
}

export const TAIL_LIMITS = { maxLines: 40, maxLineChars: 200, maxFramesPerPost: 50 } as const;

/** Client → DO: watch one item's attempt detail (null stops). One watched item per socket. */
export interface WatchMessage { type: "watch"; itemId: string | null }

/** DO → watching sockets. */
export interface TailMessage { type: "tail"; frame: TailFrame }

export interface CiPhase { name: string; status: "queued" | "running" | "passed" | "failed" | "skipped" | "unknown"; url?: string }
export type CiMessage =
  | { type: "ci"; itemId: string; available: true; sha: string; summary: string; phases: CiPhase[]; at: string }
  | { type: "ci"; itemId: string; available: false; reason: string; at: string };

/** Live-detail unavailable marker the DO sends on watch when the relay hasn't posted for this item recently. */
export interface TailUnavailableMessage { type: "tailUnavailable"; itemId: string; reason: string }

export type AttemptMessage = TailMessage | CiMessage | TailUnavailableMessage;
