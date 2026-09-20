import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HostSnapshotWire } from "@bob/ws";

import { ProxyPanel } from "../proxy-panel";

const now = new Date("2026-09-20T12:00:00.000Z");

function snapshot(proxy: HostSnapshotWire["proxy"]): HostSnapshotWire {
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

describe("ProxyPanel", () => {
  it("renders nothing for a host that is not routed through a proxy", () => {
    expect(renderToStaticMarkup(<ProxyPanel snapshot={snapshot(undefined)} now={now} />)).toBe("");
    expect(renderToStaticMarkup(<ProxyPanel snapshot={null} now={now} />)).toBe("");
  });

  it("lists accounts with their state and never the raw address", () => {
    const html = renderToStaticMarkup(
      <ProxyPanel
        now={now}
        snapshot={snapshot({
          origin: "http://proxy.internal:8317",
          reachable: true,
          latencyMs: 42,
          checkedAt: "2026-09-20T11:59:30.000Z",
          accounts: [
            { id: "claude-1", provider: "claude", label: "g…@example.com", status: "ready", requests24h: { success: 40, failed: 1 } },
            { id: "codex-1", provider: "codex", label: "m…@example.com", status: "cooldown", cooldownUntil: "2026-09-20T13:00:00.000Z", requests24h: { success: 0, failed: 2 } },
          ],
          usage: { total: { success: 40, failed: 3 }, byProvider: {} },
        })}
      />,
    );
    expect(html).toContain("Inference proxy");
    expect(html).toContain("Reachable");
    expect(html).toContain("42 ms");
    expect(html).toContain("g…@example.com");
    expect(html).toContain("Cooling down");
    expect(html).toContain("lifts in 1h");
    expect(html).toContain("43 requests in 24h · 3 failed");
    expect(html).not.toContain("graham");
  });

  it("explains missing accounts and names the variable that fixes it", () => {
    const html = renderToStaticMarkup(
      <ProxyPanel
        now={now}
        snapshot={snapshot({ origin: "http://p", reachable: true, checkedAt: now.toISOString(), managementError: "management key not configured" })}
      />,
    );
    expect(html).toContain("management key not configured");
    expect(html).toContain("CLIPROXY_MANAGEMENT_KEY");
  });

  it("leads with the outage when the proxy is unreachable", () => {
    const html = renderToStaticMarkup(
      <ProxyPanel now={now} snapshot={snapshot({ origin: "http://p", reachable: false, checkedAt: now.toISOString() })} />,
    );
    expect(html).toContain("Unreachable");
    expect(html).toContain("no run can be served");
  });
});
