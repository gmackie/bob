import { describe, expect, it, vi } from "vitest";
import { getRunTraceStatuses } from "./run-trace-status";
const traceId = "a".repeat(32),
  spanId = "b".repeat(16);
const run = {
  sessionId: "owned-session",
  artifacts: [
    {
      id: "artifact",
      metadata: {
        kind: "trace_reference",
        traceId,
        spanId,
        sampled: true,
        sessionId: "forged-session",
      },
    },
  ],
};
const config = { baseUrl: "https://forgegraf.com", token: "server-secret" };
describe("authorized run trace storage verification", () => {
  it("queries the exact root with the owned run session, not artifact metadata", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          results: [
            {
              traceId,
              spanId,
              state: "stored",
              matchedSpanCount: 1,
              checkedAt: "2026-09-16T00:00:00Z",
            },
          ],
        }),
      );
    const result = await getRunTraceStatuses(run, config, fetcher);
    expect(result).toEqual([
      {
        artifactId: "artifact",
        state: "stored",
        checkedAt: "2026-09-16T00:00:00Z",
      },
    ]);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      references: [
        {
          traceId,
          spanId,
          correlation: { key: "session.id", value: "owned-session" },
        },
      ],
    });
    expect(fetcher.mock.calls[0]![1].redirect).toBe("error");
  });
  it("never queries unsampled or unbound references", async () => {
    const fetcher = vi.fn();
    expect(
      (
        await getRunTraceStatuses({ ...run, sessionId: null }, config, fetcher)
      )[0]?.state,
    ).toBe("unavailable");
    expect(
      (
        await getRunTraceStatuses(
          {
            ...run,
            artifacts: [
              {
                ...run.artifacts[0]!,
                metadata: { ...run.artifacts[0]!.metadata, sampled: false },
              },
            ],
          },
          config,
          fetcher,
        )
      )[0]?.state,
    ).toBe("sampled_out");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("distinguishes a successful empty query from query failure", async () => {
    const empty = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          results: [{ traceId, spanId, state: "pending", matchedSpanCount: 0 }],
        }),
      );
    expect((await getRunTraceStatuses(run, config, empty))[0]?.state).toBe(
      "pending",
    );
    const failure = vi
      .fn()
      .mockRejectedValue(new Error("secret upstream error"));
    expect(await getRunTraceStatuses(run, config, failure)).toEqual([
      { artifactId: "artifact", state: "unavailable" },
    ]);
  });
  it("does not trust a response for another span or a claimed stored state without evidence", async () => {
    for (const result of [
      { traceId, spanId: "c".repeat(16), state: "stored", matchedSpanCount: 1 },
      { traceId, spanId, state: "stored" },
    ]) {
      expect(
        (
          await getRunTraceStatuses(
            run,
            config,
            vi.fn().mockResolvedValue(Response.json({ results: [result] })),
          )
        )[0]?.state,
      ).toBe("unavailable");
    }
  });
  it("fails closed for invalid origins, invalid trace IDs, oversized responses and missing configuration", async () => {
    const fetcher = vi.fn();
    for (const cfg of [
      null,
      { ...config, baseUrl: "https://attacker.example" },
    ])
      expect((await getRunTraceStatuses(run, cfg, fetcher))[0]?.state).toBe(
        "unavailable",
      );
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (
        await getRunTraceStatuses(
          {
            ...run,
            artifacts: [
              {
                ...run.artifacts[0]!,
                metadata: {
                  ...run.artifacts[0]!.metadata,
                  traceId: "0".repeat(32),
                },
              },
            ],
          },
          config,
          fetcher,
        )
      )[0]?.state,
    ).toBe("unavailable");
    const huge = vi.fn().mockResolvedValue(new Response("x".repeat(65537)));
    expect((await getRunTraceStatuses(run, config, huge))[0]?.state).toBe(
      "unavailable",
    );
  });
  it("batches at twenty and bounds the run lookup to the newest hundred references", async () => {
    const artifacts = Array.from({ length: 105 }, (_, i) => ({
      id: String(i).padStart(3, "0"),
      createdAt: "2026-09-16T00:00:00Z",
      metadata: {
        kind: "trace_reference",
        traceId,
        spanId: (i + 1).toString(16).padStart(16, "0"),
        sampled: true,
      },
    }));
    const transport = vi.fn().mockImplementation(async (_url, init) => {
      const { references } = JSON.parse(init.body);
      expect(references.length).toBeLessThanOrEqual(20);
      expect(references[0].observedAt).toBe("2026-09-16T00:00:00.000Z");
      return Response.json({
        results: references.map((reference: object) => ({
          ...reference,
          state: "stored",
          matchedSpanCount: 1,
        })),
      });
    });
    const result = await getRunTraceStatuses(
      { sessionId: "owned-session", artifacts },
      config,
      transport,
    );
    expect(transport).toHaveBeenCalledTimes(5);
    expect(result).toHaveLength(100);
    expect(result[0]?.artifactId).toBe("005");
    expect(result.every((entry) => entry.state === "stored")).toBe(true);
  });
  it("keeps the newest references even when database rows are unordered", async () => {
    const artifacts = Array.from({ length: 101 }, (_, i) => ({ id: String(i), createdAt: new Date(Date.UTC(2026, 8, 16, 0, i)), metadata: { ...run.artifacts[0]!.metadata, sampled: false } })).reverse();
    const result = await getRunTraceStatuses({ sessionId: "owned", artifacts }, config, vi.fn());
    expect(result.some((r) => r.artifactId === "100")).toBe(true);
    expect(result.some((r) => r.artifactId === "0")).toBe(false);
  });
  it("cancels unread error responses", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status: 503 });
    await getRunTraceStatuses(run, config, vi.fn().mockResolvedValue(response));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

});
