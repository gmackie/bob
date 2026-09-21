import { describe, expect, it } from "vitest";

import type { HostSnapshotWire, ProxySnapshotWire } from "./protocol";
import { deriveProxyAlertState, diffProxyAlerts, type ProxyAlertState } from "./proxy-alerts";

// Two things about the proxy stop every run: it is unreachable, or a provider
// has no ready account. Each is worth one push when it starts, not one per
// heartbeat, and nothing when it ends — the panel going green is the message.

const now = new Date("2026-09-20T12:00:00.000Z");

function snapshot(proxy: ProxySnapshotWire | undefined, checkedAt = now.toISOString()): HostSnapshotWire {
  return {
    schemaVersion: 1,
    hostId: "runner-a",
    daemonVersion: "1.0.0",
    queueDepth: 0,
    checkedAt,
    providers: [],
    ...(proxy ? { proxy } : {}),
  };
}

const account = (id: string, provider: string, status: "ready" | "cooldown" | "disabled" | "error") => ({
  id,
  provider,
  label: "g…@x",
  status,
  requests24h: { success: 0, failed: 0 },
});

describe("deriveProxyAlertState", () => {
  it("is quiet for a host without a proxy, and for a healthy proxy", () => {
    expect(deriveProxyAlertState(snapshot(undefined), now)).toEqual({ unreachable: false, providersWithoutReadyAccount: [] });
    expect(
      deriveProxyAlertState(
        snapshot({ origin: "http://p", reachable: true, checkedAt: now.toISOString(), accounts: [account("a", "claude", "ready")] }),
        now,
      ),
    ).toEqual({ unreachable: false, providersWithoutReadyAccount: [] });
  });

  it("names the providers with no ready account, sorted", () => {
    const state = deriveProxyAlertState(
      snapshot({
        origin: "http://p",
        reachable: true,
        checkedAt: now.toISOString(),
        accounts: [account("a", "codex", "cooldown"), account("b", "claude", "error"), account("c", "grok", "ready")],
      }),
      now,
    );
    expect(state).toEqual({ unreachable: false, providersWithoutReadyAccount: ["claude", "codex"] });
  });

  it("reports an unreachable proxy without also blaming every provider", () => {
    // When the proxy is down the account list is stale or absent; one alert,
    // not one per provider.
    const state = deriveProxyAlertState(
      snapshot({ origin: "http://p", reachable: false, checkedAt: now.toISOString() }),
      now,
    );
    expect(state).toEqual({ unreachable: true, providersWithoutReadyAccount: [] });
  });

  it("treats a stale host snapshot as quiet — an old outage is not evidence of one now", () => {
    const state = deriveProxyAlertState(
      snapshot({ origin: "http://p", reachable: false, checkedAt: now.toISOString() }, "2026-09-20T11:50:00.000Z"),
      now,
    );
    expect(state).toEqual({ unreachable: false, providersWithoutReadyAccount: [] });
  });
});

describe("diffProxyAlerts", () => {
  const quiet: ProxyAlertState = { unreachable: false, providersWithoutReadyAccount: [] };

  it("alerts once when the proxy becomes unreachable, and not again while it stays so", () => {
    const down: ProxyAlertState = { unreachable: true, providersWithoutReadyAccount: [] };
    const first = diffProxyAlerts(quiet, down);
    expect(first).toEqual([
      {
        type: "proxy_unreachable",
        title: "Inference proxy unreachable",
        body: "No run can be served until the proxy is back. Open Nodes to check it.",
      },
    ]);
    expect(diffProxyAlerts(down, down)).toEqual([]);
  });

  it("alerts per provider that newly has no ready account", () => {
    const next: ProxyAlertState = { unreachable: false, providersWithoutReadyAccount: ["claude", "codex"] };
    expect(diffProxyAlerts({ unreachable: false, providersWithoutReadyAccount: ["codex"] }, next)).toEqual([
      {
        type: "provider_no_ready_accounts",
        provider: "claude",
        title: "Claude has no ready account on the proxy",
        body: "Runs on Claude will fail until an account is enabled, refreshed, or its cooldown lifts.",
      },
    ]);
  });

  it("treats the first observation as a transition from quiet", () => {
    expect(diffProxyAlerts(undefined, { unreachable: true, providersWithoutReadyAccount: [] })).toHaveLength(1);
    expect(diffProxyAlerts(undefined, quiet)).toEqual([]);
  });

  it("says nothing on recovery — the panel going green is the message", () => {
    expect(diffProxyAlerts({ unreachable: true, providersWithoutReadyAccount: ["claude"] }, quiet)).toEqual([]);
  });
});
