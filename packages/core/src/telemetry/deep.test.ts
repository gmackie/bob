import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { wrapFetch } from "./worker";
import {
  captureTraceCarrier,
  validateTraceCarrier,
  getTraceReference,
  withTraceSpan,
  tracedFetch,
} from "./deep";

const traceId = "11111111111111111111111111111111";
const parentId = "2222222222222222";
const carrier = { traceparent: `00-${traceId}-${parentId}-01` };
const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    pending.push(p);
  },
};
let server: ReturnType<typeof createServer> | undefined;
afterEach(async () => {
  await Promise.all(pending.splice(0));
  server?.closeAllConnections();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});
async function receiver() {
  const bodies: any[] = [];
  server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    bodies.push(JSON.parse(body));
    res.end("{}");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    spans: () =>
      bodies.flatMap((b) =>
        b.resourceSpans.flatMap((r: any) =>
          r.scopeSpans.flatMap((s: any) => s.spans),
        ),
      ),
  };
}
describe("deep trace continuity", () => {
  it("validates serialized carriers without retaining baggage or arbitrary fields", () => {
    expect(
      validateTraceCarrier({ ...carrier, baggage: "secret", extra: "private" }),
    ).toEqual(carrier);
    expect(
      validateTraceCarrier({
        traceparent: `00-${"0".repeat(32)}-${parentId}-01`,
      }),
    ).toBeUndefined();
    expect(
      validateTraceCarrier({
        traceparent: carrier.traceparent,
        tracestate: "token=secret\r\nheader=x",
      }),
    ).toEqual(carrier);
  });
  it("exports nested operation and trusted client spans with actual parent relationships", async () => {
    const r = await receiver();
    let outgoing: string | null = null;
    const transport = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      outgoing = new Headers(init?.headers).get("traceparent");
      return new Response("ok");
    }) as typeof fetch;
    const handler = wrapFetch(
      async () => {
        await withTraceSpan(
          "planning.resolve",
          async () => {
            expect(getTraceReference()?.traceId).toBe(traceId);
            await tracedFetch(
              "https://fg.example/api/fg/work-items/secret?token=private",
              {},
              {
                service: "forgegraph",
                baseUrl: "https://fg.example",
                fetch: transport,
              },
            );
          },
          { attributes: { "work_item.id": "item-1", "issue.id": "issue-1", "forgegraph.work_item.id": "fg-1", prompt: "secret" } },
        );
        return new Response("ok");
      },
      { endpoint: r.endpoint, serviceName: "bob" },
    );
    const response = await handler(
      new Request("https://bob.example/api/health", { headers: carrier }),
      {},
      ctx,
    );
    await Promise.all(pending);
    const spans = r.spans();
    const root = spans.find((s: any) => s.kind === 2),
      op = spans.find((s: any) => s.name === "planning.resolve"),
      client = spans.find((s: any) => s.kind === 3);
    expect(spans).toHaveLength(3);
    expect(op.parentSpanId).toBe(root.spanId);
    expect(client.parentSpanId).toBe(op.spanId);
    expect(outgoing).toBe(`00-${traceId}-${client.spanId}-01`);
    expect(response.headers.get("traceparent")).toBe(
      `00-${traceId}-${root.spanId}-01`,
    );
    expect(JSON.stringify(op.attributes)).toContain("issue.id");
    expect(JSON.stringify(op.attributes)).toContain("forgegraph.work_item.id");
    expect(JSON.stringify(spans)).not.toMatch(/secret|private|prompt|token/);
  });
  it("preserves unsampled context through nested work without exporting", async () => {
    const r = await receiver();
    let captured: unknown;
    await wrapFetch(
      async () => {
        await withTraceSpan("job.consume", async () => {
          captured = captureTraceCarrier();
        });
        return new Response("ok");
      },
      { endpoint: r.endpoint, serviceName: "bob" },
    )(
      new Request("https://bob.example/", {
        headers: { traceparent: carrier.traceparent.slice(0, -2) + "00" },
      }),
      {},
      ctx,
    );
    await Promise.all(pending);
    expect(r.spans()).toHaveLength(0);
    expect((captured as any).traceparent).toMatch(
      new RegExp(`^00-${traceId}-[a-f0-9]{16}-00$`),
    );
  });
  it("links delayed attempts to persisted producing context and records safe failure", async () => {
    const r = await receiver();
    await wrapFetch(
      async () => {
        await expect(
          withTraceSpan(
            "job.attempt",
            async () => {
              throw new Error("private prompt");
            },
            {
              carrier,
              link: true,
              kind: "consumer",
              attributes: { "attempt.id": "attempt-2", "queue.wait_ms": 20 },
            },
          ),
        ).rejects.toThrow("private prompt");
        return new Response("ok");
      },
      { endpoint: r.endpoint, serviceName: "runner" },
    )(new Request("https://bob.example/"), {}, ctx);
    await Promise.all(pending);
    const attempt = r.spans().find((s: any) => s.name === "job.attempt");
    expect(attempt.traceId).not.toBe(traceId);
    expect(attempt.parentSpanId).toBeUndefined();
    expect(attempt.links).toEqual([{ traceId, spanId: parentId }]);
    expect(attempt.status.code).toBe(2);
    expect(JSON.stringify(attempt)).not.toContain("private");
  });
  it("does not inject ambient context outside the configured integration", async () => {
    const r = await receiver();
    let seen: unknown;
    const transport = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen = new Headers(init?.headers).get("traceparent");
      return new Response("ok");
    }) as typeof fetch;
    await wrapFetch(
      async () => {
        await tracedFetch(
          "https://unrelated.example/",
          {},
          {
            service: "forgegraph",
            baseUrl: "https://fg.example",
            fetch: transport,
          },
        );
        return new Response("ok");
      },
      { endpoint: r.endpoint, serviceName: "bob" },
    )(new Request("https://bob.example/", { headers: carrier }), {}, ctx);
    expect(seen).toBeNull();
  });
  it("isolates overlapping request continuations", async () => {
    const r = await receiver();
    const ids = [traceId, "33333333333333333333333333333333"];
    const seen: string[] = [];
    const handler = wrapFetch(
      async () => {
        await withTraceSpan("work", async () => {
          await new Promise((r) => setTimeout(r, 10));
          seen.push(getTraceReference()!.traceId);
        });
        return new Response("ok");
      },
      { endpoint: r.endpoint, serviceName: "bob" },
    );
    await Promise.all(
      ids.map((id) =>
        handler(
          new Request("https://bob.example/", {
            headers: { traceparent: `00-${id}-${parentId}-01` },
          }),
          {},
          ctx,
        ),
      ),
    );
    expect(seen.sort()).toEqual(ids);
    expect(getTraceReference()).toBeUndefined();
  });
});

it("builds viewer URLs only from a trusted HTTPS base and valid trace ID", async () => {
  const { buildTraceViewerUrl } = await import("./deep");
  expect(buildTraceViewerUrl(traceId, "https://trace.example")).toBe(
    `https://trace.example/trace/${traceId}`,
  );
  expect(
    buildTraceViewerUrl("../other", "https://trace.example"),
  ).toBeUndefined();
  expect(
    buildTraceViewerUrl(traceId, "https://user:secret@trace.example"),
  ).toBeUndefined();
  expect(buildTraceViewerUrl(traceId, "javascript:alert(1)")).toBeUndefined();
});

it("does not create dangling sampled parents when the request span budget is exhausted", async () => {
 const r=await receiver();let outgoing:string|null=null;
 const handler=wrapFetch(async()=>{
  for(let i=0;i<130;i++)await withTraceSpan("work",async()=>{});
  await tracedFetch("https://fg.example/",{headers:{baggage:"secret=value",tracestate:"secret=value"}},{service:"forgegraph",baseUrl:"https://fg.example",fetch:(async(_input,init)=>{const h=new Headers(init?.headers);outgoing=h.get("traceparent");expect(h.has("baggage")).toBe(false);expect(h.has("tracestate")).toBe(false);return new Response("ok");}) as typeof fetch});
  return new Response("ok");
 },{serviceName:"bob",endpoint:r.endpoint});
 await handler(new Request("https://bob.example/"),{},ctx);await Promise.all(pending);
 const parent=outgoing!.split("-")[2];expect(r.spans().some((s:any)=>s.spanId===parent)).toBe(true);
});
