import { it, expect } from "vitest";
import { EventPersistence, type SessionEventRecord } from "./persistence.js";
const event: SessionEventRecord = {
  sessionId: "s",
  seq: 1,
  direction: "agent",
  eventType: "output_chunk",
  payload: { data: "x" },
};
it("accepts only after DB commit and shutdown waits for every in-flight insert", async () => {
  let commit!: () => void;
  const barrier = new Promise<void>((r) => {
    commit = r;
  });
  const saved: number[] = [];
  const store = new EventPersistence(async (e) => {
    await barrier;
    saved.push(e.seq);
  });
  let accepted = false;
  const one = store.write(event).then(() => {
    accepted = true;
  });
  const two = store.write({ ...event, seq: 2 });
  let stopped = false;
  const stop = store.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(accepted).toBe(false);
  expect(stopped).toBe(false);
  commit();
  await Promise.all([one, two, stop]);
  expect(saved).toEqual([1, 2]);
  await expect(store.write(event)).rejects.toThrow("unavailable");
});
it("propagates DB failure instead of acknowledging queue admission", async () => {
  const store = new EventPersistence(async () => {
    throw Error("offline");
  });
  await expect(store.write(event)).rejects.toThrow("offline");
});
it("refuses saturation and reports incomplete shutdown explicitly", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((r) => {
    release = r;
  });
  const store = new EventPersistence(() => barrier, 1);
  const write = store.write(event);
  await expect(store.write(event)).rejects.toThrow("saturated");
  await expect(store.stop(5)).rejects.toThrow("incomplete");
  release();
  await write;
});
it("shutdown waits for other writes after one insert fails", async () => {
  let finish!: () => void;
  const barrier = new Promise<void>((r) => {
    finish = r;
  });
  const store = new EventPersistence(async (e) => {
    if (e.seq === 1) throw Error("offline");
    await barrier;
  });
  const failure = store.write(event).catch(() => {});
  const success = store.write({ ...event, seq: 2 });
  let stopped = false;
  const stop = store.stop().catch((error) => {
    stopped = true;
    throw error;
  });
  await failure;
  expect(stopped).toBe(false);
  finish();
  await success;
  await expect(stop).rejects.toThrow("failed writes");
});
