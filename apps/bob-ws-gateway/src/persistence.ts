import type { EventDirection, SessionEventType } from "./protocol.js";
export interface SessionEventRecord {
  sessionId: string;
  seq: number;
  direction: EventDirection;
  eventType: SessionEventType;
  payload: Record<string, unknown>;
}
/** No memory-only admission: a write is accepted only after its DB commit. */
export class EventPersistence {
  private readonly pending = new Set<Promise<void>>();
  private stopped = false;
  constructor(
    private readonly insert: (event: SessionEventRecord) => Promise<void>,
    private readonly maxPending = 1000,
  ) {}
  write(event: SessionEventRecord): Promise<void> {
    if (this.stopped || this.pending.size >= this.maxPending)
      return Promise.reject(Error("Persistence unavailable or saturated"));
    const task = Promise.resolve().then(() => this.insert(event));
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task),
    );
    return task;
  }
  isHealthy(): boolean {
    return !this.stopped && this.pending.size < this.maxPending;
  }
  async stop(timeoutMs = 10_000): Promise<void> {
    this.stopped = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.pending]).then((results) => {
          const errors = results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason as unknown);
          if (errors.length)
            throw new AggregateError(
              errors,
              "Persistence shutdown contained failed writes",
            );
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error(
                  "Persistence shutdown incomplete: pending database writes",
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
