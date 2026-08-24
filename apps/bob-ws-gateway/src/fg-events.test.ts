import { describe, expect, it, vi } from "vitest";

import { SseParser, isPipelineEvent, startFgEventsBridge } from "./fg-events";

describe("SseParser", () => {
  it("parses a complete event with id/event/data", () => {
    const p = new SseParser();
    const out = p.feed('id: 1|bus|ci.started\nevent: ci.started\ndata: {"buildId":"b1"}\n\n');
    expect(out).toEqual([{ id: "1|bus|ci.started", event: "ci.started", data: '{"buildId":"b1"}' }]);
    expect(p.lastEventId).toBe("1|bus|ci.started");
  });

  it("carries partial events across chunks and ignores keepalive comments", () => {
    const p = new SseParser();
    expect(p.feed(": keepalive\n\nevent: deploy.active\nda")).toEqual([]);
    expect(p.feed('ta: {"a":1}\n\n')).toEqual([{ id: undefined, event: "deploy.active", data: '{"a":1}' }]);
  });

  it("joins multi-line data and tolerates CRLF", () => {
    const p = new SseParser();
    const out = p.feed("event: x\r\ndata: line1\r\ndata: line2\r\n\r\n");
    expect(out[0]!.data).toBe("line1\nline2");
  });
});

describe("isPipelineEvent", () => {
  it("accepts ci/changeset/deploy/alert families and rejects job/noise", () => {
    expect(isPipelineEvent("ci.failed")).toBe(true);
    expect(isPipelineEvent("changeset.merged")).toBe(true);
    expect(isPipelineEvent("deploy.active")).toBe(true);
    expect(isPipelineEvent("alert.firing")).toBe(true);
    expect(isPipelineEvent("job.completed")).toBe(false);
    expect(isPipelineEvent(undefined)).toBe(false);
  });
});

describe("startFgEventsBridge", () => {
  it("coalesces a burst of events into one onEvents call and sends Last-Event-ID on reconnect", async () => {
    const seenHeaders: Record<string, string>[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seenHeaders.push({ ...(init?.headers as Record<string, string>) });
      calls++;
      const body =
        calls === 1
          ? 'id: e1\nevent: ci.started\ndata: {"buildId":"b1"}\n\nid: e2\nevent: job.done\ndata: {}\n\nid: e3\nevent: ci.passed\ndata: {"buildId":"b1"}\n\n'
          : "";
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    const onEvents = vi.fn();
    const stop = startFgEventsBridge({
      baseUrl: "https://fg.test",
      token: "t",
      onEvents,
      log: () => {},
      coalesceMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await vi.waitFor(() => expect(onEvents).toHaveBeenCalled(), { timeout: 2000 });
    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(onEvents.mock.calls[0]![0].map((e: { type: string }) => e.type)).toEqual(["ci.started", "ci.passed"]);
    // the stream ended → reconnect after ~1 s with Last-Event-ID = e3
    await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThan(1), { timeout: 3000 });
    expect(seenHeaders[1]!["Last-Event-ID"]).toBe("e3");
    stop();
  });
});
