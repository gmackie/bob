import type { EventDirection, SessionEventType } from "../ws/protocol.js";

export interface SessionEventRecord {
  sessionId: string;
  seq: number;
  direction: EventDirection;
  eventType: SessionEventType;
  payload: Record<string, unknown>;
}

export interface PersistenceWriterConfig {
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  onBatchWrite: (events: SessionEventRecord[]) => Promise<void>;
  onError?: (error: Error, events: SessionEventRecord[]) => void;
}

export class PersistenceWriter {
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxQueueSize: number;
  private readonly onBatchWrite: (events: SessionEventRecord[]) => Promise<void>;
  private readonly onError?: (error: Error, events: SessionEventRecord[]) => void;

  private queue: SessionEventRecord[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isWriting = false;
  private isStopped = false;

  constructor(config: PersistenceWriterConfig) {
    this.batchSize = config.batchSize ?? 50;
    this.flushIntervalMs = config.flushIntervalMs ?? 100;
    this.maxQueueSize = config.maxQueueSize ?? 10000;
    this.onBatchWrite = config.onBatchWrite;
    this.onError = config.onError;
  }

  start(): void {
    this.isStopped = false;
    this.scheduleFlush();
  }

  async stop(): Promise<void> {
    this.isStopped = true;
    this.clearFlushTimer();

    if (this.queue.length > 0) {
      await this.flush();
    }
  }

  enqueue(event: SessionEventRecord): boolean {
    if (this.isStopped) {
      return false;
    }

    if (this.queue.length >= this.maxQueueSize) {
      console.warn(`[PersistenceWriter] Queue full, dropping event for session ${event.sessionId}`);
      return false;
    }

    this.queue.push(event);

    if (this.queue.length >= this.batchSize) {
      this.triggerFlush();
    }

    return true;
  }

  private scheduleFlush(): void {
    if (this.isStopped || this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.triggerFlush();
    }, this.flushIntervalMs);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private triggerFlush(): void {
    if (this.isWriting || this.queue.length === 0) {
      if (!this.isStopped) {
        this.scheduleFlush();
      }
      return;
    }

    this.flush().catch((error) => {
      console.error("[PersistenceWriter] Flush error:", error);
    });
  }

  private async flush(): Promise<void> {
    if (this.isWriting || this.queue.length === 0) {
      return;
    }

    this.isWriting = true;
    this.clearFlushTimer();

    const batch = this.queue.splice(0, this.batchSize);

    try {
      await this.onBatchWrite(batch);
    } catch (error) {
      console.error(`[PersistenceWriter] Failed to write ${batch.length} events:`, error);
      this.onError?.(error as Error, batch);
    } finally {
      this.isWriting = false;

      if (!this.isStopped) {
        if (this.queue.length >= this.batchSize) {
          setImmediate(() => this.triggerFlush());
        } else {
          this.scheduleFlush();
        }
      }
    }
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  isHealthy(): boolean {
    return this.queue.length < this.maxQueueSize * 0.8;
  }

  getStats(): {
    queueSize: number;
    maxQueueSize: number;
    isWriting: boolean;
    isStopped: boolean;
    healthPercent: number;
  } {
    return {
      queueSize: this.queue.length,
      maxQueueSize: this.maxQueueSize,
      isWriting: this.isWriting,
      isStopped: this.isStopped,
      healthPercent: Math.round((1 - this.queue.length / this.maxQueueSize) * 100),
    };
  }
}
