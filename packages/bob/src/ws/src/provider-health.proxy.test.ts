import { describe, expect, it } from "vitest";

import { buildHostMissionControl } from "./provider-health";
import type { HostSnapshotWire, ProviderHealthWire } from "./protocol";

function provider(over: Partial<ProviderHealthWire>): ProviderHealthWire {
  return {
    provider: "claude",
    command: "claude",
    installed: true,
    authenticated: true,
    status: "ready",
    capabilities: {},
    checkedAt: "2026-09-20T12:00:00.000Z",
    ...over,
  };
}

function snapshot(providers: ProviderHealthWire[]): HostSnapshotWire {
  return {
    schemaVersion: 1,
    hostId: "runner-a",
    daemonVersion: "1.0.0",
    queueDepth: 0,
    checkedAt: "2026-09-20T12:00:00.000Z",
    providers,
  };
}

describe("buildHostMissionControl — inference proxy", () => {
  const now = new Date("2026-09-20T12:00:30.000Z");

  it("labels an unreachable proxy and offers the check-proxy remedy", () => {
    const control = buildHostMissionControl(
      snapshot([provider({ status: "proxy_unreachable", via: "proxy", error: "inference proxy unreachable" })]),
      now,
    );
    expect(control.providers[0]).toMatchObject({
      statusLabel: "Proxy unreachable",
      remedy: "check_proxy",
      via: "proxy",
    });
  });

  it("pauses dispatch when every provider is behind an unreachable proxy", () => {
    // Mirrors the runner's dispatch gate: confirmed dead, so paused.
    const control = buildHostMissionControl(
      snapshot([
        provider({ status: "proxy_unreachable", via: "proxy" }),
        provider({ provider: "codex", command: "codex", status: "proxy_unreachable", via: "proxy" }),
      ]),
      now,
    );
    expect(control.dispatchPaused).toBe(true);
    expect(control.blockedProviders).toEqual(["claude", "codex"]);
  });

  it("carries the source so the UI can say whether it is showing the proxy or the host", () => {
    const control = buildHostMissionControl(
      snapshot([provider({ via: "proxy" }), provider({ provider: "grok", command: "grok", via: "host" })]),
      now,
    );
    expect(control.providers.map((p) => p.via)).toEqual(["proxy", "host"]);
  });

  it("treats a snapshot without `via` as host-sourced, for daemons that predate the proxy", () => {
    const control = buildHostMissionControl(snapshot([provider({})]), now);
    expect(control.providers[0]!.via).toBe("host");
  });
});
