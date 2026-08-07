import { describe, expect, it, vi } from "vitest";

import type { AppendConversationEventInputV1 } from "@gmacko/ooda-client/v1";

import { OodaConversationOutbox } from "./ooda-outbox";
import type { OodaOutboxStorage } from "./ooda-outbox";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  const operations: string[] = [];
  const storage: OodaOutboxStorage = {
    getItem() {
      operations.push("read");
      return Promise.resolve(value);
    },
    setItem(_key, next) {
      operations.push("write");
      value = next;
      return Promise.resolve();
    },
  };
  return { storage, operations, read: () => value };
}

function ids(...values: string[]) {
  const remaining = [...values];
  return () => remaining.shift() ?? "fallback-id";
}

function deliveryResult(input: AppendConversationEventInputV1) {
  return {
    event: {
      id: `server-${input.idempotencyKey}`,
      ...input,
      sequence: "1",
    },
    replayed: false,
  };
}

describe("OODA conversation outbox", () => {
  it("durably queues an accepted turn before any delivery begins", async () => {
    const persisted = memoryStorage();
    const appendEvent = vi.fn((input: AppendConversationEventInputV1) => Promise.resolve(deliveryResult(input)));
    const outbox = new OodaConversationOutbox({
      storage: persisted.storage,
      appendEvent,
      createId: ids("device-event", "correlation"),
      now: () => "2026-08-06T12:00:00.000Z",
    });

    const item = await outbox.enqueueTurn({
      conversationId: "conversation-1",
      branchId: "branch-1",
      text: "A thought that cannot be lost",
    });

    expect(item).toMatchObject({
      id: "device-event",
      idempotencyKey: "device-event",
      status: "queued",
      input: {
        payload: { display: "A thought that cannot be lost" },
        correlationId: "correlation",
      },
    });
    expect(persisted.operations).toEqual(["write"]);
    expect(appendEvent).not.toHaveBeenCalled();
    expect(persisted.read()).toContain("A thought that cannot be lost");
  });

  it("restores queued work after restart and resets interrupted syncing work", async () => {
    const persisted = memoryStorage(JSON.stringify({
      version: 1,
      items: [
        {
          id: "device-event",
          conversationId: "conversation-1",
          branchId: "branch-1",
          idempotencyKey: "device-event",
          status: "syncing",
          attempts: 1,
          createdAt: "2026-08-06T12:00:00.000Z",
          updatedAt: "2026-08-06T12:00:01.000Z",
          input: {
            conversationId: "conversation-1",
            branchId: "branch-1",
            type: "user_turn",
            actor: { type: "user" },
            payload: { display: "Still here" },
            sensitivity: "personal",
            correlationId: "correlation",
            idempotencyKey: "device-event",
            occurredAt: "2026-08-06T12:00:00.000Z"
          }
        }
      ]
    }));
    const outbox = new OodaConversationOutbox({
      storage: persisted.storage,
      appendEvent: vi.fn(),
    });

    await outbox.hydrate();

    expect(outbox.snapshot()).toMatchObject([
      { id: "device-event", status: "queued", attempts: 1 },
    ]);
    expect(persisted.operations).toEqual(["read", "write"]);
  });

  it("delivers each conversation in order and removes acknowledged events", async () => {
    const persisted = memoryStorage();
    const deliveredKeys: string[] = [];
    const appendEvent = vi.fn((input: AppendConversationEventInputV1) => {
      deliveredKeys.push(input.idempotencyKey);
      return Promise.resolve({
        event: {
          id: `server-${input.idempotencyKey}`,
          ...input,
          sequence: String(deliveredKeys.length),
        },
        replayed: false,
      });
    });
    const outbox = new OodaConversationOutbox({
      storage: persisted.storage,
      appendEvent,
      createId: ids("event-1", "correlation-1", "event-2", "correlation-2"),
      now: () => "2026-08-06T12:00:00.000Z",
    });
    await outbox.enqueueTurn({
      conversationId: "conversation-1",
      branchId: "branch-1",
      text: "First",
    });
    await outbox.enqueueTurn({
      conversationId: "conversation-1",
      branchId: "branch-1",
      text: "Second",
    });

    const receipts = await outbox.flush();

    expect(deliveredKeys).toEqual(["event-1", "event-2"]);
    expect(receipts.map((receipt) => receipt.item.id)).toEqual(["event-1", "event-2"]);
    expect(outbox.snapshot()).toEqual([]);
  });

  it("keeps a failed turn visible and blocks later turns in that conversation", async () => {
    const persisted = memoryStorage();
    const appendEvent = vi.fn().mockRejectedValue(Object.assign(
      new Error("offline"),
      { status: 503 },
    ));
    const outbox = new OodaConversationOutbox({
      storage: persisted.storage,
      appendEvent,
      createId: ids("event-1", "correlation-1", "event-2", "correlation-2"),
      now: () => "2026-08-06T12:00:00.000Z",
      maxAttempts: 1,
    });
    await outbox.enqueueTurn({
      conversationId: "conversation-1",
      branchId: "branch-1",
      text: "First",
    });
    await outbox.enqueueTurn({
      conversationId: "conversation-1",
      branchId: "branch-1",
      text: "Second",
    });

    await outbox.flush();

    expect(appendEvent).toHaveBeenCalledOnce();
    expect(outbox.snapshot()).toMatchObject([
      { id: "event-1", status: "failed", attempts: 1, error: "offline" },
      { id: "event-2", status: "queued", attempts: 0 },
    ]);

    await outbox.retry("event-1");
    expect(outbox.snapshot()[0]).toMatchObject({
      id: "event-1",
      status: "queued",
      attempts: 0,
      idempotencyKey: "event-1",
    });
  });

  it("coalesces concurrent flushes so an idempotency key is sent once", async () => {
    const persisted = memoryStorage();
    let release: (() => void) | undefined;
    const appendEvent = vi.fn((input: AppendConversationEventInputV1) => new Promise<ReturnType<typeof deliveryResult>>((resolve) => {
      release = () => resolve(deliveryResult(input));
    }));
    const outbox = new OodaConversationOutbox({
      storage: persisted.storage,
      appendEvent,
      createId: ids("event-1", "correlation-1"),
      now: () => "2026-08-06T12:00:00.000Z",
    });
    await outbox.enqueueTurn({
      conversationId: "conversation-1",
      branchId: "branch-1",
      text: "Only once",
    });

    const first = outbox.flush();
    const second = outbox.flush();
    await vi.waitFor(() => expect(appendEvent).toHaveBeenCalledOnce());
    release?.();

    await expect(Promise.all([first, second])).resolves.toBeDefined();
    expect(appendEvent).toHaveBeenCalledOnce();
  });

  it("keeps a delivered user turn durable until its host turn completes", async () => {
    const persisted = memoryStorage();
    let finishHost: (() => void) | undefined;
    const outbox = new OodaConversationOutbox({
      storage: persisted.storage,
      appendEvent: (input) => Promise.resolve(deliveryResult(input)),
      completeTurn: () => new Promise<void>((resolve) => {
        finishHost = resolve;
      }),
      createId: ids("event-1", "correlation-1"),
      now: () => "2026-08-06T12:00:00.000Z",
    });
    await outbox.enqueueTurn({
      conversationId: "conversation-1",
      branchId: "branch-1",
      text: "Do not lose the answer request",
    });

    const flush = outbox.flush();
    await vi.waitFor(() => expect(finishHost).toBeDefined());
    expect(outbox.snapshot()).toMatchObject([{ id: "event-1", status: "syncing" }]);
    expect(persisted.read()).toContain("Do not lose the answer request");

    finishHost?.();
    await flush;
    expect(outbox.snapshot()).toEqual([]);
  });

  it("requeues an accepted user turn while its host lease is still running", async () => {
    const persisted = memoryStorage();
    const outbox = new OodaConversationOutbox({
      storage: persisted.storage,
      appendEvent: (input) => Promise.resolve(deliveryResult(input)),
      completeTurn: () => Promise.reject(Object.assign(
        new Error("This user turn is already being answered"),
        { status: 409, code: "HOST_TURN_IN_PROGRESS" },
      )),
      createId: ids("event-1", "correlation-1"),
      now: () => "2026-08-06T12:00:00.000Z",
      maxAttempts: 3,
    });
    await outbox.enqueueTurn({
      conversationId: "conversation-1",
      branchId: "branch-1",
      text: "Resume this answer after restart",
    });

    await outbox.flush();

    expect(outbox.snapshot()).toMatchObject([{
      id: "event-1",
      status: "queued",
      attempts: 1,
      error: "This user turn is already being answered",
    }]);
  });
});
