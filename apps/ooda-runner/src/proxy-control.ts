/**
 * Act on the inference proxy from the UI: refresh, enable or disable an
 * account, or test the connection.
 *
 * The proxy's management key lives on this host and nowhere else — not in the
 * Bob server, not in a workspace secret, never on the wire. So the runner is
 * the only place that can act on an account. The UI asks over the gateway
 * (proxy_control), the runner answers with proxy_control_result and then
 * pushes a fresh host snapshot so the panel shows what the proxy says now.
 *
 * Accounts are addressed by the id the runner itself reported in its last
 * heartbeat. Anything else is stale or forged and does not reach the proxy.
 */

import { redactDetail, type ProxyRoute } from "@bob/execution/providers";
import type { ProxyAccountWire, ProxyControlAction } from "@bob/ws";

const CONTROL_TIMEOUT_MS = 15_000;

const ACTIONS: readonly ProxyControlAction[] = ["refresh", "enable", "disable", "test"];

export interface ProxyControlOptions {
  route: ProxyRoute;
  /** `CLIPROXY_MANAGEMENT_KEY`; account actions are refused without it. */
  managementKey?: string;
  send: (msg: Record<string, unknown>) => void;
  /** The accounts from the last heartbeat — the only ids the UI may name. */
  accounts: () => readonly ProxyAccountWire[];
  /** Push a fresh host snapshot after an action, whatever its outcome. */
  refreshSnapshot: () => Promise<void>;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export class ProxyControl {
  constructor(private readonly opts: ProxyControlOptions) {}

  async apply(requestId: string, action: ProxyControlAction, accountId?: string): Promise<void> {
    const result = await this.perform(action, accountId);
    this.opts.send({ type: "proxy_control_result", requestId, ...result });
    // Whatever the proxy answered, show what it says now.
    try {
      await this.opts.refreshSnapshot();
    } catch {
      // The result already went out; a failed refresh shows up as a stale snapshot.
    }
  }

  private async perform(
    action: ProxyControlAction,
    accountId: string | undefined,
  ): Promise<{ ok: boolean; detail?: string }> {
    if (!ACTIONS.includes(action)) {
      return { ok: false, detail: `unknown proxy action ${String(action)}` };
    }
    const base = this.opts.route.baseUrl.replace(/\/+$/, "");
    const doFetch = this.opts.fetch ?? fetch;

    if (action === "test") {
      return this.request(doFetch, `${base}/v1/models`, {
        method: "GET",
        headers: { authorization: `Bearer ${this.opts.route.apiKey}` },
      });
    }

    if (!this.opts.managementKey) {
      return {
        ok: false,
        detail: "the runner has no CLIPROXY_MANAGEMENT_KEY, so it cannot change accounts on the proxy",
      };
    }
    const account = accountId ? this.opts.accounts().find((a) => a.id === accountId) : undefined;
    if (!account) {
      return { ok: false, detail: `unknown account ${String(accountId ?? "")}`.trim() };
    }
    // The management API addresses an auth by auth_index or file name; use the
    // most specific handle the proxy gave us.
    const handle = account.ref?.authIndex
      ? { auth_index: account.ref.authIndex }
      : account.ref?.name
        ? { name: account.ref.name }
        : undefined;
    if (!handle) {
      return { ok: false, detail: "the proxy reported no management handle for this account" };
    }
    const headers = { authorization: `Bearer ${this.opts.managementKey}`, "content-type": "application/json" };

    if (action === "refresh") {
      return this.request(doFetch, `${base}/v0/management/auth-files/refresh`, {
        method: "POST",
        headers,
        body: JSON.stringify(handle),
      });
    }
    return this.request(doFetch, `${base}/v0/management/auth-files/status`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ ...handle, disabled: action === "disable" }),
    });
  }

  private async request(
    doFetch: typeof fetch,
    url: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; detail?: string }> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS) });
    } catch (error) {
      return { ok: false, detail: `proxy unreachable: ${redactDetail(error instanceof Error ? error.message : "request failed")}` };
    }
    if (response.ok) return { ok: true };
    let detail = `proxy answered HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error.trim()) {
        detail = `${detail}: ${redactDetail(body.error.trim())}`;
      }
    } catch {
      // status alone is enough
    }
    return { ok: false, detail };
  }
}
