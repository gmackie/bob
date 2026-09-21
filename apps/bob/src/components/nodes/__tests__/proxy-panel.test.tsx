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

  it("offers the actions that fit each account's state, and a connection test", () => {
    const html = renderToStaticMarkup(
      <ProxyPanel
        now={now}
        onAction={() => {}}
        snapshot={snapshot({
          origin: "http://p",
          reachable: true,
          checkedAt: now.toISOString(),
          accounts: [
            { id: "on", provider: "claude", label: "a…@x", status: "ready", requests24h: { success: 0, failed: 0 } },
            { id: "off", provider: "codex", label: "b…@x", status: "disabled", requests24h: { success: 0, failed: 0 } },
          ],
        })}
      />,
    );
    // A ready account can be refreshed or disabled; a disabled one can only be enabled.
    expect(html).toMatch(/data-testid="proxy-action-refresh-on"/);
    expect(html).toMatch(/data-testid="proxy-action-disable-on"/);
    expect(html).not.toMatch(/data-testid="proxy-action-enable-on"/);
    expect(html).toMatch(/data-testid="proxy-action-enable-off"/);
    expect(html).not.toMatch(/data-testid="proxy-action-disable-off"/);
    expect(html).toMatch(/data-testid="proxy-action-test"/);
  });

  it("renders no controls when there is no way to act, rather than buttons that do nothing", () => {
    const html = renderToStaticMarkup(
      <ProxyPanel
        now={now}
        snapshot={snapshot({
          origin: "http://p",
          reachable: true,
          checkedAt: now.toISOString(),
          accounts: [{ id: "on", provider: "claude", label: "a…@x", status: "ready", requests24h: { success: 0, failed: 0 } }],
        })}
      />,
    );
    expect(html).not.toMatch(/data-testid="proxy-action-/);
  });

  it("shows the proxy's answer to the last action", () => {
    const html = renderToStaticMarkup(
      <ProxyPanel
        now={now}
        onAction={() => {}}
        lastResult={{ ok: false, detail: "proxy answered HTTP 401: invalid management key" }}
        snapshot={snapshot({ origin: "http://p", reachable: true, checkedAt: now.toISOString(), accounts: [] })}
      />,
    );
    expect(html).toContain("invalid management key");
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
