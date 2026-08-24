/**
 * ForgeGraph → cockpit bridge. Holds one SSE connection to ForgeGraph's
 * `GET /api/fg/events` (CI build lifecycle from its in-memory bus, plus
 * deployments / alerts / job runs polled from its DB) and turns each relevant
 * event into an `external_pipeline_changed` invalidation for every
 * workspace-subscribed browser. The cockpit refetches `cockpit.status` on it,
 * so a CI build starting or a deploy landing shows up within a second instead
 * of on the next 10 s poll.
 *
 * Naturally dark: no FG_API_TOKEN → never starts. Reconnects with backoff and
 * resumes from Last-Event-ID. Bursts are coalesced (one broadcast per
 * COALESCE_MS) since every broadcast costs each wall a status refetch.
 *
 * The SSE parser is pure and unit-tested; the network loop is thin.
 */

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

/**
 * Incremental SSE parser: feed chunks, get complete events. Handles events
 * split across chunks, multi-line `data:`, comments (`: keepalive`), and
 * CRLF. Per the spec an event is dispatched on a blank line.
 */
export class SseParser {
  private buffer = "";
  private id: string | undefined;
  private event: string | undefined;
  private data: string[] = [];

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const out: SseEvent[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line === "") {
        if (this.data.length) out.push({ id: this.id, event: this.event, data: this.data.join("\n") });
        this.event = undefined;
        this.data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") this.data.push(value);
      else if (field === "event") this.event = value;
      else if (field === "id") this.id = value;
    }
    return out;
  }

  /** The last event id seen — sent back as Last-Event-ID on reconnect. */
  get lastEventId(): string | undefined {
    return this.id;
  }
}

/** Which ForgeGraph event types the cockpit cares about. */
export function isPipelineEvent(type: string | undefined): boolean {
  if (!type) return false;
  return /^(ci|changeset|cascade|deploy|alert)\./.test(type);
}

export interface FgEventsBridgeOptions {
  baseUrl: string;
  token: string;
  /** Called with a coalesced batch of pipeline events. */
  onEvents: (events: { type: string; data: Record<string, unknown> }[]) => void;
  log?: (msg: string) => void;
  coalesceMs?: number;
  fetchImpl?: typeof fetch;
}

const COALESCE_MS = 750;

export function startFgEventsBridge(opts: FgEventsBridgeOptions): () => void {
  const log = opts.log ?? ((m: string) => console.log(m));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const coalesceMs = opts.coalesceMs ?? COALESCE_MS;
  let stopped = false;
  let backoffMs = 1_000;
  let lastEventId: string | undefined;
  let abort: AbortController | null = null;
  let pending: { type: string; data: Record<string, unknown> }[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  const flush = () => {
    flushTimer = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    try {
      opts.onEvents(batch);
    } catch (err) {
      log(`[fg-events] onEvents failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const run = async () => {
    while (!stopped) {
      abort = new AbortController();
      const parser = new SseParser();
      try {
        const res = await fetchImpl(`${opts.baseUrl.replace(/\/$/, "")}/api/fg/events`, {
          headers: {
            Authorization: `Bearer ${opts.token}`,
            Accept: "text/event-stream",
            ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
          },
          signal: abort.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }
        log(`[fg-events] connected to ${opts.baseUrl}`);
        backoffMs = 1_000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
            if (ev.id) lastEventId = ev.id;
            if (!isPipelineEvent(ev.event)) continue;
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(ev.data) as Record<string, unknown>;
            } catch {
              /* keep an empty payload; the type alone is enough to refetch */
            }
            pending.push({ type: ev.event!, data });
            if (!flushTimer) flushTimer = setTimeout(flush, coalesceMs);
          }
        }
        throw new Error("stream ended");
      } catch (err) {
        if (stopped) break;
        log(`[fg-events] disconnected (${err instanceof Error ? err.message : String(err)}); retry in ${backoffMs}ms`);
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 60_000);
      }
    }
  };
  void run();

  return () => {
    stopped = true;
    abort?.abort();
    if (flushTimer) clearTimeout(flushTimer);
    flush();
  };
}
