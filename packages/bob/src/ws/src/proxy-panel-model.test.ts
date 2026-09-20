import { describe, expect, it } from "vitest";

import type { HostSnapshotWire, ProxyAccountWire, ProxySnapshotWire } from "./protocol";
import { buildProxyPanel } from "./proxy-panel-model";

// One view-model for the inference proxy, shared by the web Nodes page and
// the phone, so the two cannot disagree about what a cooldown looks like.

const now = new Date("2026-09-20T12:00:00.000Z");

function account(over: Partial<ProxyAccountWire>): ProxyAccountWire {
  return {
    id: "claude-1",
    provider: "claude",
    label: "g…@example.com",
    status: "ready",
    requests24h: { success: 40, failed: 1 },
    ...over,
  };
}

function snapshot(proxy: ProxySnapshotWire | undefined): HostSnapshotWire {
  return {
    schemaVersion: 1,
    hostId: "runner-a",
    daemonVersion: "1.0.0",
    queueDepth: 0,
    checkedAt: now.toISOString(),
    providers: [],
    ...(proxy ? { proxy } : {}),
  };
}

const healthy: ProxySnapshotWire = {
  origin: "http://proxy.internal:8317",
  reachable: true,
  latencyMs: 42,
  checkedAt: "2026-09-20T11:59:30.000Z",
  accounts: [
    account({}),
    account({ id: "claude-2", status: "cooldown", cooldownUntil: "2026-09-20T13:59:00.000Z", cooldownReason: "rate_limited", requests24h: { success: 10, failed: 5 } }),
    account({ id: "codex-1", provider: "codex", requests24h: { success: 200, failed: 0 } }),
    account({ id: "xai-1", provider: "grok", status: "error", detail: "refresh failed", requests24h: { success: 0, failed: 0 } }),
    account({ id: "kimi-1", provider: "kimi", status: "disabled", requests24h: { success: 0, failed: 0 } }),
  ],
  usage: { total: { success: 250, failed: 6 }, byProvider: { claude: { success: 50, failed: 6 }, codex: { success: 200, failed: 0 }, grok: { success: 0, failed: 0 }, kimi: { success: 0, failed: 0 } } },
};

describe("buildProxyPanel", () => {
  it("is null when the host is not routed through a proxy, or there is no snapshot", () => {
    expect(buildProxyPanel(null, now)).toBeNull();
    expect(buildProxyPanel(snapshot(undefined), now)).toBeNull();
  });

  it("summarises a reachable proxy", () => {
    const panel = buildProxyPanel(snapshot(healthy), now)!;
    expect(panel).toMatchObject({
      origin: "http://proxy.internal:8317",
      reachable: true,
      statusLabel: "Reachable",
      tone: "green",
      latencyLabel: "42 ms",
      checkedLabel: "30s ago",
      accountsState: "listed",
    });
  });

  it("groups accounts by provider with counts a person can read at a glance", () => {
    const panel = buildProxyPanel(snapshot(healthy), now)!;
    expect(panel.providers.map((p) => [p.provider, p.label, p.summary, p.tone])).toEqual([
      ["claude", "Claude", "1 ready · 1 cooling down", "green"],
      ["codex", "Codex", "1 ready", "green"],
      ["grok", "Grok", "1 error", "amber"],
      ["kimi", "Kimi", "1 disabled", "grey"],
    ]);
  });

  it("renders each account with a status label, a cooldown countdown and its 24h requests", () => {
    const panel = buildProxyPanel(snapshot(healthy), now)!;
    const cooling = panel.accounts.find((a) => a.id === "claude-2")!;
    expect(cooling).toMatchObject({
      statusLabel: "Cooling down",
      tone: "amber",
      cooldownLabel: "lifts in 1h 59m",
      requestsLabel: "10 ok · 5 failed",
      detail: "rate_limited",
    });
    const errored = panel.accounts.find((a) => a.id === "xai-1")!;
    expect(errored).toMatchObject({ statusLabel: "Error", tone: "red", detail: "refresh failed" });
    const disabled = panel.accounts.find((a) => a.id === "kimi-1")!;
    expect(disabled).toMatchObject({ statusLabel: "Disabled", tone: "grey", canEnable: true, canDisable: false });
    expect(panel.accounts.find((a) => a.id === "claude-1")).toMatchObject({ canDisable: true, canEnable: false });
  });

  it("raises an alert for a provider with no serviceable account, and only then", () => {
    const panel = buildProxyPanel(snapshot(healthy), now)!;
    expect(panel.alerts).toEqual(["Grok has no ready account on the proxy", "Kimi has no ready account on the proxy"]);
  });

  it("says why accounts are missing when only reachability is known", () => {
    const panel = buildProxyPanel(
      snapshot({ origin: "http://p", reachable: true, checkedAt: now.toISOString(), managementError: "management key not configured" }),
      now,
    )!;
    expect(panel).toMatchObject({ accountsState: "unavailable", accountsNote: "management key not configured", providers: [], accounts: [] });
    expect(panel.alerts).toEqual([]);
  });

  it("reads red when the proxy is unreachable, and leads with that", () => {
    const panel = buildProxyPanel(
      snapshot({ origin: "http://p", reachable: false, checkedAt: now.toISOString() }),
      now,
    )!;
    expect(panel).toMatchObject({ statusLabel: "Unreachable", tone: "red", latencyLabel: null });
    expect(panel.alerts[0]).toMatch(/unreachable/i);
  });

  it("goes grey when the host snapshot itself is stale, whatever it last said", () => {
    const panel = buildProxyPanel(snapshot(healthy), new Date("2026-09-20T12:05:00.000Z"))!;
    expect(panel.tone).toBe("grey");
    expect(panel.statusLabel).toBe("Stale");
  });

  it("totals usage for the header", () => {
    const panel = buildProxyPanel(snapshot(healthy), now)!;
    expect(panel.usageLabel).toBe("256 requests in 24h · 6 failed");
  });
});
