import { describe, expect, it } from "vitest";
import type { HostSnapshotWire, ProviderHealthWire } from "@bob/ws";

import { buildSidebarStatus } from "../sidebar-status-model";

// One glance at the bottom of the sidebar answers: is the proxy up, are the
// agents usable, is anything queued. The strip is rendered on every page, so
// it has to be honest about "unknown" rather than defaulting to green.

const now = new Date("2026-09-20T12:00:00.000Z");

function provider(over: Partial<ProviderHealthWire>): ProviderHealthWire {
  return {
    provider: "claude",
    command: "claude",
    installed: true,
    authenticated: true,
    status: "ready",
    capabilities: {},
    checkedAt: now.toISOString(),
    ...over,
  };
}

function snapshot(over: Partial<HostSnapshotWire>): HostSnapshotWire {
  return {
    schemaVersion: 1,
    hostId: "runner-a",
    daemonVersion: "1.0.0",
    queueDepth: 0,
    checkedAt: now.toISOString(),
    providers: [provider({}), provider({ provider: "codex", command: "codex" })],
    ...over,
  };
}

describe("buildSidebarStatus", () => {
  it("says unknown, not fine, before the host has reported", () => {
    expect(buildSidebarStatus(null, now)).toEqual({
      tone: "grey",
      headline: "No host reporting",
      detail: "Waiting for the runner's first heartbeat",
      href: "/nodes",
      rows: [],
    });
  });

  it("summarises a healthy host with a proxy", () => {
    const status = buildSidebarStatus(
      snapshot({
        queueDepth: 2,
        proxy: {
          origin: "http://p",
          reachable: true,
          checkedAt: now.toISOString(),
          accounts: [{ id: "a", provider: "claude", label: "g…@x", status: "ready", requests24h: { success: 1, failed: 0 } }],
        },
      }),
      now,
    );
    expect(status).toMatchObject({
      tone: "green",
      headline: "All systems go",
      href: "/nodes",
    });
    expect(status.rows).toEqual([
      { label: "Proxy", value: "Reachable", tone: "green" },
      { label: "Agents", value: "2 of 2 ready", tone: "green" },
      { label: "Queue", value: "2 active", tone: "green" },
    ]);
  });

  it("leads with the proxy when it is unreachable", () => {
    const status = buildSidebarStatus(
      snapshot({
        providers: [provider({ status: "proxy_unreachable", via: "proxy" })],
        proxy: { origin: "http://p", reachable: false, checkedAt: now.toISOString() },
      }),
      now,
    );
    expect(status).toMatchObject({ tone: "red", headline: "Inference proxy unreachable" });
    expect(status.rows[0]).toEqual({ label: "Proxy", value: "Unreachable", tone: "red" });
  });

  it("goes amber when an agent needs a person", () => {
    const status = buildSidebarStatus(
      snapshot({ providers: [provider({}), provider({ provider: "codex", command: "codex", status: "unauthenticated", authenticated: false })] }),
      now,
    );
    expect(status).toMatchObject({ tone: "amber", headline: "1 agent needs attention" });
    expect(status.rows.find((r) => r.label === "Agents")).toEqual({ label: "Agents", value: "1 of 2 ready", tone: "amber" });
  });

  it("goes grey when the host has gone quiet, whatever it last said", () => {
    const status = buildSidebarStatus(snapshot({}), new Date("2026-09-20T12:05:00.000Z"));
    expect(status).toMatchObject({ tone: "grey", headline: "Host stale" });
  });

  it("omits the proxy row for a host that is not routed through one", () => {
    const status = buildSidebarStatus(snapshot({}), now);
    expect(status.rows.map((r) => r.label)).toEqual(["Agents", "Queue"]);
  });
});
