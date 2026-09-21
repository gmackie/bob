import { describe, expect, it } from "vitest";
import type { HostSnapshotWire, ProxySnapshotWire } from "./protocol.js";

import { ProxyAlertNotifier } from "./proxy-alert-notifier.js";

// The runner heartbeats every ~30s. A proxy outage is worth one push when it
// begins, to the workspace owner, and silence after — not thirty pushes an
// hour, and nothing on recovery.

const now = new Date("2026-09-20T12:00:00.000Z");

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

const down: ProxySnapshotWire = { origin: "http://p", reachable: false, checkedAt: now.toISOString() };
const up: ProxySnapshotWire = {
  origin: "http://p",
  reachable: true,
  checkedAt: now.toISOString(),
  accounts: [{ id: "a", provider: "claude", label: "g…@x", status: "ready", requests24h: { success: 0, failed: 0 } }],
};
const noClaude: ProxySnapshotWire = {
  ...up,
  accounts: [{ id: "a", provider: "claude", label: "g…@x", status: "cooldown", requests24h: { success: 0, failed: 0 } }],
};

function harness(owner: string | null = "user-owner") {
  const pushes: Array<{ userId: string; notification: Record<string, unknown> }> = [];
  const notifier = new ProxyAlertNotifier({
    push: async (userId, notification) => {
      pushes.push({ userId, notification });
    },
    ownerOf: async () => owner,
    now: () => now,
  });
  return { notifier, pushes };
}

describe("ProxyAlertNotifier", () => {
  it("pushes the owner once when the proxy goes down, then stays quiet while it stays down", async () => {
    const h = harness();
    await h.notifier.observe("ws-1", snapshot(down));
    await h.notifier.observe("ws-1", snapshot(down));
    await h.notifier.observe("ws-1", snapshot(down));
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]).toMatchObject({
      userId: "user-owner",
      notification: {
        type: "proxy_unreachable",
        title: "Inference proxy unreachable",
        priority: "high",
        data: { type: "proxy.alert", href: "/nodes", url: "/nodes", workspaceId: "ws-1" },
      },
    });
  });

  it("pushes again only after a recovery and a fresh outage", async () => {
    const h = harness();
    await h.notifier.observe("ws-1", snapshot(down));
    await h.notifier.observe("ws-1", snapshot(up));
    await h.notifier.observe("ws-1", snapshot(down));
    expect(h.pushes.map((p) => p.notification.type)).toEqual(["proxy_unreachable", "proxy_unreachable"]);
  });

  it("pushes per provider that loses its last ready account", async () => {
    const h = harness();
    await h.notifier.observe("ws-1", snapshot(up));
    await h.notifier.observe("ws-1", snapshot(noClaude));
    await h.notifier.observe("ws-1", snapshot(noClaude));
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]!.notification).toMatchObject({
      type: "provider_no_ready_accounts",
      title: "Claude has no ready account on the proxy",
    });
  });

  it("keeps workspaces apart", async () => {
    const h = harness();
    await h.notifier.observe("ws-1", snapshot(down));
    await h.notifier.observe("ws-2", snapshot(down));
    expect(h.pushes.map((p) => p.notification.data)).toEqual([
      expect.objectContaining({ workspaceId: "ws-1" }),
      expect.objectContaining({ workspaceId: "ws-2" }),
    ]);
  });

  it("does nothing for a host without a proxy, or a workspace without an owner", async () => {
    const h = harness();
    await h.notifier.observe("ws-1", snapshot(undefined));
    expect(h.pushes).toEqual([]);
    const orphan = harness(null);
    await orphan.notifier.observe("ws-1", snapshot(down));
    expect(orphan.pushes).toEqual([]);
  });

  it("survives a push failure and still records the state, so it does not retry every heartbeat", async () => {
    let attempts = 0;
    const notifier = new ProxyAlertNotifier({
      push: async () => {
        attempts += 1;
        throw new Error("expo down");
      },
      ownerOf: async () => "user-owner",
      now: () => now,
    });
    await notifier.observe("ws-1", snapshot(down));
    await notifier.observe("ws-1", snapshot(down));
    expect(attempts).toBe(1);
  });
});
