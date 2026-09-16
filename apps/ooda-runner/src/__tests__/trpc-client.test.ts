import { describe, it, expect, vi } from "vitest";
import { createRunnerTRPCClient } from "../trpc-client";

describe("createRunnerTRPCClient", () => {
  it("creates a client without throwing", () => {
    const client = createRunnerTRPCClient("http://localhost:3000");
    expect(client).toBeDefined();
    expect(client.threads).toBeDefined();
    expect(client.runner).toBeDefined();
  });
});

it("keeps concurrent job trace contexts on separate outgoing requests", async () => {
  const { wrapFetch } = await import("@gmacko/core/telemetry/worker");
  const seen: string[] = [];
  const mock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      if (String(input).includes("/v1/traces")) return new Response("{}");
      seen.push(new Headers(init?.headers).get("traceparent") ?? "");
      const result = { result: { data: { json: null } } };
      return new Response(
        JSON.stringify(
          String(input).includes("batch=1") ? [result, result] : result,
        ),
        { headers: { "content-type": "application/json" } },
      );
    });
  const client = createRunnerTRPCClient("https://ooda.example");
  const pending: Promise<unknown>[] = [];
  const handler = wrapFetch(
    async () => {
      await (client as any).jobs.control.query({
        jobId: "job-1",
        runnerId: "runner-1",
        leaseToken: "token",
      });
      return new Response("ok");
    },
    { endpoint: "https://collector.example", serviceName: "runner" },
  );
  const ids = [
    "11111111111111111111111111111111",
    "33333333333333333333333333333333",
  ];
  try {
    await Promise.all(
      ids.map((id) =>
        handler(
          new Request("https://runner.example/", {
            headers: { traceparent: `00-${id}-2222222222222222-01` },
          }),
          {},
          { waitUntil: (p) => pending.push(p) },
        ),
      ),
    );
    await Promise.all(pending);
    expect(seen).toHaveLength(2);
    expect(seen.map((x) => x.split("-")[1]).sort()).toEqual(ids);
  } finally {
    mock.mockRestore();
  }
});
