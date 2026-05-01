import postgres from "postgres";

type Callback = (payload: string) => void;

interface ChannelState {
  subscribers: Set<Callback>;
  unlisten: (() => Promise<void>) | null;
}

export class ListenBroker {
  private sql: ReturnType<typeof postgres>;
  private channels = new Map<string, ChannelState>();

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
        void s.unlisten?.();
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
    try {
      await this.sql.end({ timeout: 2 });
    } catch {
      // best effort
    }
  }
}
