/**
 * BOB-76: the budget usage collector that runs on the proxy host.
 *
 * CLIProxyAPI's usage queue pops destructively, so exactly one process may
 * drain it. Draining from the host the proxy runs on (labnuc) keeps the
 * ledger independent of any runner: a runner restart, a runner on another
 * host, or no runner at all no longer loses usage records. The collector
 * posts running totals to the gateway's /internal/budget-usage endpoint with
 * a Bob API key owned by the workspace owner. Runners then set
 * BOB_BUDGET_USAGE_SOURCE=remote and only ship run-to-session links.
 *
 * Built as one self-contained file (see docs/ops/budget-collector.md) so the
 * proxy host needs Node and nothing else.
 */

import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { UsagePoller } from "./usage-poller";

export interface CollectorConfig {
  proxyBaseUrl: string;
  managementKey: string;
  bobApiKeys: string[];
  gatewayUrl: string;
  token: string;
  workspaceId: string;
  hostId: string;
  spoolPath: string;
  intervalMs: number;
}

const REQUIRED = ["CLIPROXY_MANAGEMENT_KEY", "BOB_BUDGET_BOB_API_KEYS", "BOB_GATEWAY_INTERNAL_URL", "BOB_BUDGET_COLLECTOR_TOKEN", "BOB_WORKSPACE_ID"] as const;

/** Read the collector's configuration; throws naming every missing variable (never their values). */
export function collectorConfigFromEnv(env: Record<string, string | undefined>): CollectorConfig {
  const value = (name: string) => env[name]?.trim() ?? "";
  const missing = REQUIRED.filter((name) => !value(name));
  if (missing.length) throw new Error(`budget collector: missing ${missing.join(", ")}`);
  const bobApiKeys = value("BOB_BUDGET_BOB_API_KEYS")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return {
    proxyBaseUrl: value("CLIPROXY_BASE_URL") || "http://127.0.0.1:8317",
    managementKey: value("CLIPROXY_MANAGEMENT_KEY"),
    bobApiKeys,
    gatewayUrl: value("BOB_GATEWAY_INTERNAL_URL").replace(/\/+$/, ""),
    token: value("BOB_BUDGET_COLLECTOR_TOKEN"),
    workspaceId: value("BOB_WORKSPACE_ID"),
    hostId: value("BOB_BUDGET_HOST_ID") || hostname(),
    spoolPath: value("BOB_BUDGET_SPOOL") || join(homedir(), ".bob-budget-collector", "usage-ledger.json"),
    intervalMs: Number(value("BOB_BUDGET_INTERVAL_MS")) || 15_000,
  };
}

/** POST one budget_usage message to the gateway. Resolves true when stored. */
export function gatewaySender(
  config: Pick<CollectorConfig, "gatewayUrl" | "token" | "workspaceId" | "hostId">,
  fetchImpl: typeof fetch = fetch,
  log: (line: Record<string, unknown>) => void = () => {},
) {
  return async (message: Record<string, unknown>): Promise<boolean> => {
    const response = await fetchImpl(`${config.gatewayUrl}/internal/budget-usage`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...message, workspaceId: config.workspaceId, hostId: config.hostId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return true;
    log({ step: "budget-collector", outcome: "rejected", status: response.status });
    return false;
  };
}

export function createCollector(config: CollectorConfig, deps: { fetch?: typeof fetch; log?: (line: Record<string, unknown>) => void; now?: () => Date } = {}) {
  const log = deps.log ?? ((line) => console.log(JSON.stringify(line)));
  return new UsagePoller({
    baseUrl: config.proxyBaseUrl,
    managementKey: config.managementKey,
    bobApiKeys: config.bobApiKeys,
    spoolPath: config.spoolPath,
    send: gatewaySender(config, deps.fetch, log),
    isConnected: () => true,
    intervalMs: config.intervalMs,
    log,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
}

async function main(): Promise<void> {
  const config = collectorConfigFromEnv(process.env);
  const poller = createCollector(config);
  console.log(
    JSON.stringify({
      step: "budget-collector",
      outcome: "started",
      hostId: config.hostId,
      proxy: config.proxyBaseUrl,
      gateway: config.gatewayUrl,
      bobKeys: config.bobApiKeys.length,
    }),
  );
  poller.start();
  const report = setInterval(() => console.log(JSON.stringify({ step: "budget-collector", outcome: "status", ...poller.status() })), 600_000);
  const shutdown = (signal: string) => {
    clearInterval(report);
    poller.stop();
    // One last drain so records popped after the final tick are not left to expire.
    void poller.tick().finally(() => {
      console.log(JSON.stringify({ step: "budget-collector", outcome: "stopped", signal, ...poller.status() }));
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
