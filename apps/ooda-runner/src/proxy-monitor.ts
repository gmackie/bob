/**
 * Inference-proxy monitor: one poll of CLIProxyAPI, folded into the redacted
 * `ProxySnapshotWire` that rides inside the host snapshot heartbeat.
 *
 * Two calls, two keys, deliberately kept apart:
 *
 * - `GET /v1/models` with the proxy API key — the same call the probe makes —
 *   answers "is the proxy up and does it accept this host's key". This is all
 *   a host can know without management access, and it is enough for the
 *   agent lights.
 * - `GET /v0/management/auth-files` with the management key answers "which
 *   accounts, in what state". Optional: a host without the management key
 *   still reports reachability and says why accounts are absent.
 *
 * Neither key is ever written into the snapshot. `origin` is scheme+host+port
 * only, so a proxy mounted under a path cannot leak that path either.
 */

import type { ProxyRoute } from "@bob/execution/providers";
import { foldProxyAccounts, summarizeProxyUsage, type ManagementAuthFile, type ProxySnapshotWire } from "@bob/ws";

export interface ProxyMonitorOptions {
  route: ProxyRoute;
  /** `CLIPROXY_MANAGEMENT_KEY`; when absent, accounts are not fetched. */
  managementKey?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function originOf(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.origin;
  } catch {
    return baseUrl.replace(/\/+$/, "");
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "request failed";
}

export async function collectProxySnapshot(
  options: ProxyMonitorOptions,
  now = new Date(),
): Promise<ProxySnapshotWire> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = options.route.baseUrl.replace(/\/+$/, "");
  const snapshot: ProxySnapshotWire = {
    origin: originOf(options.route.baseUrl),
    reachable: false,
    checkedAt: now.toISOString(),
  };

  // Reachability, with the inference key.
  const started = Date.now();
  try {
    const response = await doFetch(`${base}/v1/models`, {
      headers: { authorization: `Bearer ${options.route.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    snapshot.latencyMs = Date.now() - started;
    // A 401 here means the *inference* key is wrong; the probe reports that
    // per provider. The proxy itself is up, which is what this field means.
    snapshot.reachable = response.status < 500;
  } catch {
    snapshot.reachable = false;
    return snapshot;
  }

  // Accounts, with the management key.
  if (!options.managementKey) {
    snapshot.managementError = "management key not configured";
    return snapshot;
  }
  try {
    const response = await doFetch(`${base}/v0/management/auth-files`, {
      headers: { authorization: `Bearer ${options.managementKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      snapshot.managementError = `management API answered HTTP ${response.status}`;
      return snapshot;
    }
    const body = (await response.json()) as { files?: ManagementAuthFile[] } | ManagementAuthFile[];
    const files = Array.isArray(body) ? body : (body.files ?? []);
    const accounts = foldProxyAccounts(files, now);
    snapshot.accounts = accounts;
    snapshot.usage = summarizeProxyUsage(accounts);
  } catch (error) {
    snapshot.managementError = `management API failed: ${describe(error)}`;
  }
  return snapshot;
}
