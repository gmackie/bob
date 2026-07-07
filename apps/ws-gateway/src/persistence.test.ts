import { describe, it, expect, vi } from "vitest";
import { PersistenceWriter, type SessionEventRecord } from "./persistence.js";

function makeEvent(sessionId: string, seq: number): SessionEventRecord {
  return {
    sessionId,
    seq,
    direction: "agent",
    eventType: "output_chunk",
    payload: { data: `chunk-${seq}` },
  };
}

describe("PersistenceWriter", () => {
  it("batches events and flushes on batchSize", async () => {
    const writes: SessionEventRecord[][] = [];
    const writer = new PersistenceWriter({
      batchSize: 3,
      flushIntervalMs: 1000,
      onBatchWrite: async (batch) => {
        writes.push(batch);
      },
    });
    writer.start();

    writer.enqueue(makeEvent("s1", 1));
    writer.enqueue(makeEvent("s1", 2));
    writer.enqueue(makeEvent("s1", 3));

    // Allow the triggerFlush microtask to run
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(writes.length).toBe(1);
    expect(writes[0]).toHaveLength(3);
    await writer.stop();
  });

  it("flushes on interval when batch is not full", async () => {
    const writes: SessionEventRecord[][] = [];
    const writer = new PersistenceWriter({
      batchSize: 100,
      flushIntervalMs: 50,
      onBatchWrite: async (batch) => {
        writes.push(batch);
      },
    });
    writer.start();

    writer.enqueue(makeEvent("s1", 1));
    writer.enqueue(makeEvent("s1", 2));

    await new Promise((r) => setTimeout(r, 100));

    expect(writes.length).toBe(1);
    expect(writes[0]).toHaveLength(2);
    await writer.stop();
  });

  it("keeps buffering events when queue crosses the health threshold", () => {
    const writer = new PersistenceWriter({
      batchSize: 1000,
      flushIntervalMs: 1000,
      maxQueueSize: 2,
      onBatchWrite: async () => {},
    });
    writer.start();

    expect(writer.enqueue(makeEvent("s1", 1))).toBe(true);
    expect(writer.enqueue(makeEvent("s1", 2))).toBe(true);
    expect(writer.enqueue(makeEvent("s1", 3))).toBe(true);
    expect(writer.getQueueSize()).toBe(3);
    expect(writer.isHealthy()).toBe(false);
  });

  it("flushes remaining events on stop", async () => {
    const writes: SessionEventRecord[][] = [];
    const writer = new PersistenceWriter({
      batchSize: 100,
      flushIntervalMs: 10000,
      onBatchWrite: async (batch) => {
        writes.push(batch);
      },
    });
    writer.start();
    writer.enqueue(makeEvent("s1", 1));

    await writer.stop();

    expect(writes.length).toBe(1);
    expect(writes[0]).toHaveLength(1);
  });

  it("calls onError when batch write throws", async () => {
    const errors: Array<{ error: Error; events: SessionEventRecord[] }> = [];
    const writer = new PersistenceWriter({
      batchSize: 1,
      flushIntervalMs: 1000,
      onBatchWrite: async () => {
        throw new Error("db down");
      },
      onError: (error, events) => {
        errors.push({ error, events });
      },
    });
    writer.start();
    writer.enqueue(makeEvent("s1", 1));

    await new Promise((r) => setTimeout(r, 50));

    expect(errors.length).toBe(1);
    expect(errors[0]?.error.message).toBe("db down");
    await writer.stop();
  });
});
