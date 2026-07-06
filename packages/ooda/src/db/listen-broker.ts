import postgres from "postgres";

type Callback = (payload: string) => void;

interface ChannelState {
  subscribers: Set<Callback>;
  unlisten: (() => Promise<void>) | null;
}

export class ListenBroker {
  private sql: ReturnType<typeof postgres>;
  private channels = new Map<string, ChannelState>();

  /**
   * In-flight `UNLISTEN` operations kicked off by the unsubscribe closure
   * returned from `subscribe()`. That closure is synchronous (callers just
   * invoke it, they don't `await` it), so the actual `UNLISTEN` SQL command
   * is fired-and-forgotten against `this.sql`'s underlying connection. If
   * `close()` (or process exit) tears down that connection before the
   * in-flight `UNLISTEN` completes, postgres.js rejects it with
   * `CONNECTION_DESTROYED` — and since nothing was awaiting it, that surfaces
   * as an unhandled rejection. We track each fire-and-forget unlisten here so
   * `close()` can await (and swallow errors from) all of them before ending
   * the connection, closing the race instead of leaving it to chance.
   */
  private pendingUnlistens = new Set<Promise<unknown>>();

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  get channelCount(): number {
    return this.channels.size;
  }

  async subscribe(channel: string, cb: Callback): Promise<() => void> {
    let state = this.channels.get(channel);

    if (!state) {
      state = { subscribers: new Set(), unlisten: null };
      this.channels.set(channel, state);

      const meta = await this.sql.listen(channel, (raw: string) => {
        const s = this.channels.get(channel);
        if (!s) return;
        for (const subscriber of s.subscribers) {
          try {
            subscriber(raw);
          } catch {
            // subscriber error -- don't break the fan-out
          }
        }
      });

      state.unlisten = () => meta.unlisten();
    }

    state.subscribers.add(cb);

    return () => {
      const s = this.channels.get(channel);
      if (!s) return;
      s.subscribers.delete(cb);
      if (s.subscribers.size === 0) {
        const unlistenResult = s.unlisten?.();
        if (unlistenResult) {
          // Track it so close() can wait for it; swallow rejections here so
          // an unawaited teardown race doesn't become an unhandled rejection
          // even when close() is never called (e.g. process exit).
          const tracked = unlistenResult.catch(() => {
            // best effort -- connection may already be closing/closed.
          });
          this.pendingUnlistens.add(tracked);
          void tracked.finally(() => this.pendingUnlistens.delete(tracked));
        }
        this.channels.delete(channel);
      }
    };
  }

  async close(): Promise<void> {
    for (const [, state] of this.channels) {
      try {
        await state.unlisten?.();
      } catch {
        // best effort
      }
    }
    this.channels.clear();

    // Wait for any fire-and-forget unlistens kicked off by unsubscribe
    // closures before ending the connection, so we don't race an in-flight
    // UNLISTEN against connection teardown (see `pendingUnlistens` above).
    if (this.pendingUnlistens.size > 0) {
      await Promise.all(this.pendingUnlistens);
    }

    try {
      await this.sql.end({ timeout: 2 });
    } catch {
      // best effort
    }
  }
}
