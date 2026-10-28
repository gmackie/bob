/**
 * Mirror a t3code thread back into an OODA session.
 *
 * The installed t3code server does not push runtime events to OODA, so after
 * `dispatchOodaSessionToT3Code` the runner polls `/api/orchestration/snapshot`
 * for the thread it created (`ooda-session-<sessionId>`), forwards each new
 * assistant message as a session event, and resolves once the provider session
 * is idle again (no active turn) with at least one assistant message, or when
 * the provider reports an error.
 */

export interface T3MirrorSnapshotThread {
  id: string;
  updatedAt?: string;
  latestTurn?: { state?: string; completedAt?: string | null } | null;
  session?: {
    status?: string;
    activeTurnId?: string | null;
    lastError?: unknown;
    updatedAt?: string;
  } | null;
  messages?: Array<{
    id: string;
    role: string;
    text: string;
    isStreaming?: boolean;
    createdAt?: string;
  }>;
}

export interface T3MirrorOptions {
  serverUrl: string;
  authToken?: string;
  threadId: string;
  /** Called with the text of each assistant message the first time it is seen (or grows). */
  onAssistantMessage: (text: string, messageId: string) => void | Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Grace period after the last observed change before treating an idle session as finished. */
  settleMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface T3MirrorResult {
  status: "completed" | "failed" | "timed_out";
  finalText: string | null;
  error: string | null;
}

async function fetchThread(
  opts: T3MirrorOptions,
): Promise<T3MirrorSnapshotThread | null> {
  const url = new URL(opts.serverUrl);
  url.pathname = "/api/orchestration/snapshot";
  url.search = "";
  url.hash = "";
  const headers: Record<string, string> = {};
  if (opts.authToken) headers.Authorization = `Bearer ${opts.authToken}`;
  const fetchFn = opts.fetchImpl ?? fetch;
  const response = await fetchFn(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`t3code snapshot failed: ${response.status}`);
  }
  const snapshot = (await response.json()) as { threads?: T3MirrorSnapshotThread[] };
  return snapshot.threads?.find((thread) => thread.id === opts.threadId) ?? null;
}

function errorText(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return JSON.stringify(value);
}

export async function mirrorT3ThreadToSession(
  opts: T3MirrorOptions,
): Promise<T3MirrorResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 3_000;
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
  const settleMs = opts.settleMs ?? 5_000;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;

  const startedAt = now();
  const seen = new Map<string, number>(); // messageId -> text length forwarded
  let lastText: string | null = null;
  let lastChangeAt = startedAt;
  let sawActiveTurn = false;
  let consecutiveFetchErrors = 0;

  while (now() - startedAt < timeoutMs) {
    let thread: T3MirrorSnapshotThread | null = null;
    try {
      thread = await fetchThread(opts);
      consecutiveFetchErrors = 0;
    } catch (error) {
      consecutiveFetchErrors += 1;
      if (consecutiveFetchErrors >= 10) {
        return {
          status: "failed",
          finalText: lastText,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await sleep(pollIntervalMs);
      continue;
    }

    if (thread) {
      const session = thread.session ?? null;
      if (session?.activeTurnId) sawActiveTurn = true;

      for (const message of thread.messages ?? []) {
        if (message.role !== "assistant") continue;
        const text = message.text ?? "";
        const forwarded = seen.get(message.id) ?? -1;
        if (text.length > forwarded && text.trim().length > 0 && !message.isStreaming) {
          seen.set(message.id, text.length);
          lastText = text;
          lastChangeAt = now();
          await opts.onAssistantMessage(text, message.id);
        }
      }

      const lastError = errorText(session?.lastError);
      if (lastError) {
        return { status: "failed", finalText: lastText, error: lastError };
      }

      // NOTE: `latestTurn.state` flips to "completed" as soon as the first
      // assistant message lands, while the provider keeps running tools. The
      // live signal is the provider session: idle (`ready`, no active turn).
      const providerIdle = !session?.activeTurnId && session?.status === "ready";
      const turnFailed = thread.latestTurn?.state === "failed";
      const idleFor = now() - lastChangeAt;
      if (lastText !== null && providerIdle && (sawActiveTurn || idleFor >= settleMs)) {
        return {
          status: turnFailed ? "failed" : "completed",
          finalText: lastText,
          error: null,
        };
      }
    }

    await sleep(pollIntervalMs);
  }

  return { status: "timed_out", finalText: lastText, error: "t3code turn did not finish in time" };
}
