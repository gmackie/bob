import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectorConfigFromEnv, createCollector, gatewaySender } from "./collector";

const ENV = {
  CLIPROXY_MANAGEMENT_KEY: "mgmt",
  BOB_BUDGET_BOB_API_KEYS: "sk-bob-1, sk-bob-2,",
  BOB_GATEWAY_INTERNAL_URL: "http://gateway.test:3003/",
  BOB_BUDGET_COLLECTOR_TOKEN: "bob_key",
  BOB_WORKSPACE_ID: "ws-1",
  BOB_BUDGET_HOST_ID: "labnuc",
};

describe("collectorConfigFromEnv", () => {
  it("reads the configuration with defaults", () => {
    expect(collectorConfigFromEnv(ENV)).toMatchObject({
      proxyBaseUrl: "http://127.0.0.1:8317",
      bobApiKeys: ["sk-bob-1", "sk-bob-2"],
      gatewayUrl: "http://gateway.test:3003",
      hostId: "labnuc",
      intervalMs: 15_000,
    });
  });

  it("names every missing variable without echoing values", () => {
    expect(() => collectorConfigFromEnv({ CLIPROXY_MANAGEMENT_KEY: "secret-value" })).toThrow(
      "budget collector: missing BOB_BUDGET_BOB_API_KEYS, BOB_GATEWAY_INTERNAL_URL, BOB_BUDGET_COLLECTOR_TOKEN, BOB_WORKSPACE_ID",
    );
  });
});

describe("collector", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bob-budget-collector-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("drains the proxy queue and posts totals to the gateway with its workspace and host", async () => {
    const queue = [
      { timestamp: "2026-11-15T10:01:00Z", provider: "claude", model: "claude-opus-5-5", auth_index: "a1", api_key: "sk-bob-2", session_id: "s1", tokens: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } },
      { timestamp: "2026-11-15T10:02:00Z", provider: "claude", model: "claude-opus-5-5", auth_index: "a1", api_key: "sk-someone", session_id: "s2", tokens: { input_tokens: 7, output_tokens: 1, total_tokens: 8 } },
    ];
    const posts: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
    let gatewayUp = false;
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v0/management/usage-queue")) return Response.json(queue.splice(0));
      posts.push({ url, auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(null, { status: gatewayUp ? 200 : 503 });
    }) as typeof fetch;
    const collector = createCollector(
      { ...collectorConfigFromEnv(ENV), spoolPath: join(dir, "ledger.json") },
      { fetch: fetchImpl, log: () => {}, now: () => new Date("2026-11-15T10:05:00Z") },
    );

    await collector.tick();
    expect(collector.status().sendFailures).toBe(1);
    gatewayUp = true;
    await collector.tick();

    const last = posts.at(-1);
    expect(last?.url).toBe("http://gateway.test:3003/internal/budget-usage");
    expect(last?.auth).toBe("Bearer bob_key");
    expect(last?.body).toMatchObject({ type: "budget_usage", workspaceId: "ws-1", hostId: "labnuc" });
    const sources = (last?.body.buckets as Array<{ source: string; requests: number }>).map((b) => [b.source, b.requests]).sort();
    expect(sources).toEqual([["bob", 1], ["interactive", 1]]);
    expect(JSON.stringify(posts)).not.toContain("sk-bob-2");
  });

  it("gatewaySender reports a rejected post as undelivered", async () => {
    const send = gatewaySender({ gatewayUrl: "http://g", token: "t", workspaceId: "w", hostId: "h" }, (async () => new Response(null, { status: 401 })) as typeof fetch);
    await expect(send({ type: "budget_usage" })).resolves.toBe(false);
  });
});
