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

/**
 * Parses and validates an encoded answer against the pending questions. Null when invalid.
 * Every question answered, no unknown ids, values non-empty strings of at most 4000
 * characters, an array only for multiSelect, and — for a question with options — every
 * value one of its option values (`value ?? label`); free text only when it has none.
 * Ported to packages/bob/coordination/runtime/input.mjs (and the mobile app).
 */
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
    if (q.options.length > 0) {
      const allowed = new Set(q.options.map(o => o.value ?? o.label));
      if (values.some(v => !allowed.has(v as string))) return null;
    }
  }
  return answers as Answers;
}

// Whole escape sequences first (CSI, OSC, DCS/SOS/PM/APC, 7- and 8-bit forms, and the
// two-byte ESC forms), then any remaining C0/C1 control character. An unterminated
// string sequence swallows the rest of the text, which is the safe reading.
const ESCAPE_SEQUENCES = new RegExp([
  "(?:\\u001b\\[|\\u009b)[\\u0030-\\u003f]*[\\u0020-\\u002f]*[\\u0040-\\u007e]?",
  "(?:\\u001b[\\]PX^_]|[\\u0090\\u0098\\u009d\\u009e\\u009f])[^\\u0007\\u001b\\u009c]*(?:\\u0007|\\u001b\\\\|\\u009c)?",
  "\\u001b[\\u0020-\\u002f]*[\\u0030-\\u007e]?",
].join("|"), "g");
const CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;
const LINE_BREAKS = /\r\n|[\r\n\u2028\u2029]/g;

/**
 * Agent- or repo-sourced text made safe for a terminal or a single-line UI field: removes
 * whole ANSI/OSC/CSI escape sequences and every other C0/C1 control character except tab.
 * `multiline` keeps line feeds (CRLF/CR become LF); otherwise line breaks become spaces.
 */
export function stripTerminalControls(text: string, { multiline = false }: { multiline?: boolean } = {}): string {
  const lines = text.replace(LINE_BREAKS, multiline ? "\n" : " ");
  const parts = multiline ? lines.split("\n") : [lines];
  return parts.map(part => part.replace(ESCAPE_SEQUENCES, "").replace(CONTROL_CHARS, "")).join("\n");
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
