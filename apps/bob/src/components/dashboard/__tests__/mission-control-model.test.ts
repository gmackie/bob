import { describe, expect, it } from "vitest";

import {
  buildHostMissionControl,
  buildHostMissionControlFromHeartbeat,
  getMissionControlSections,
} from "../mission-control-model";

describe("mission control model", () => {
  it("keeps the Tasks dashboard centered on capacity, summary boxes, and live work", () => {
    expect(getMissionControlSections()).toEqual([
      "provider-capacity",
      "work-pipeline",
      "running-now",
    ]);
    expect(getMissionControlSections()).not.toContain("activity-feed");
  });

  it("builds honest host and provider state with capability-gated controls", () => {
    const model = buildHostMissionControl({
      schemaVersion: 1,
      hostId: "hetzner-bob",
      daemonVersion: "dev",
      queueDepth: 1,
      checkedAt: "2026-07-11T18:00:00.000Z",
      providers: [{
        provider: "grok",
        command: "grok",
        installed: true,
        authenticated: true,
        status: "ready",
        checkedAt: "2026-07-11T18:00:00.000Z",
        capabilities: { cancel: true, resume: false, approval: true },
      }],
    }, new Date("2026-07-11T18:00:30.000Z"));

    expect(model).toMatchObject({
      hostId: "hetzner-bob",
      statusLabel: "Online",
      queueLabel: "1 active",
      providers: [{ label: "Grok", statusLabel: "Ready", controls: ["approve", "cancel"] }],
    });
  });

  it("falls back to the polled workspace heartbeat when no websocket snapshot is cached", () => {
    expect(buildHostMissionControlFromHeartbeat({
      hostId: "hetzner-bob",
      lastHeartbeat: "2026-07-12T14:16:27.000Z",
    }, new Date("2026-07-12T14:16:50.000Z"))).toMatchObject({
      hostId: "hetzner-bob",
      statusLabel: "Online",
      queueLabel: "Activity unavailable",
      providers: [],
    });
  });
});

describe("provider remediation", () => {
  const snapshot = (status: string, detail?: string) =>
    ({
      schemaVersion: 1,
      hostId: "host",
      daemonVersion: "1",
      queueDepth: 0,
      checkedAt: new Date().toISOString(),
      providers: [
        {
          provider: "grok",
          command: "grok",
          installed: true,
          authenticated: status !== "unauthenticated",
          status,
          detail,
          capabilities: {},
          checkedAt: new Date().toISOString(),
        },
      ],
    }) as never;

  it("offers top-up, never sign-in, for an exhausted balance", () => {
    // Re-authenticating does not buy credit. Showing "Sign in" here is what
    // made the 2026-08-29 outage last eight days.
    const [provider] = buildHostMissionControl(snapshot("no_credit", "402 Payment Required")).providers;
    expect(provider?.remedy).toBe("top_up");
    expect(provider?.statusLabel).toBe("Out of credit");
    expect(provider?.detail).toBe("402 Payment Required");
  });

  it("offers sign-in for an expired credential", () => {
    const [provider] = buildHostMissionControl(snapshot("unauthenticated")).providers;
    expect(provider?.remedy).toBe("sign_in");
  });

  it("offers no action for a healthy provider", () => {
    const [provider] = buildHostMissionControl(snapshot("ready")).providers;
    expect(provider?.remedy).toBeNull();
  });

  it("offers install, not sign-in, for a missing CLI", () => {
    const [provider] = buildHostMissionControl(snapshot("unavailable")).providers;
    expect(provider?.remedy).toBe("install");
  });
});

describe("dispatch pause derivation", () => {
  const withProviders = (statuses: string[]) =>
    ({
      schemaVersion: 1,
      hostId: "host",
      daemonVersion: "1",
      queueDepth: 0,
      checkedAt: new Date().toISOString(),
      providers: statuses.map((status, i) => ({
        provider: ["claude", "codex", "grok"][i] ?? "claude",
        command: "x",
        installed: true,
        authenticated: true,
        status,
        capabilities: {},
        checkedAt: new Date().toISOString(),
      })),
    }) as never;

  it("pauses when every agent is confirmed dead — the 2026-08-29 state", () => {
    const host = buildHostMissionControl(
      withProviders(["unauthenticated", "unauthenticated", "no_credit"]),
    );
    expect(host.dispatchPaused).toBe(true);
    expect(host.blockedProviders).toHaveLength(3);
  });

  it("does not pause while one agent is still ready", () => {
    expect(
      buildHostMissionControl(withProviders(["unauthenticated", "ready", "no_credit"]))
        .dispatchPaused,
    ).toBe(false);
  });

  it("does NOT pause on uncertain evidence", () => {
    // A status this build does not recognise is not proof of anything. Halting
    // the backlog on it is the wedge agentHealthRouter.ts warns against.
    expect(
      buildHostMissionControl(withProviders(["degraded", "something_unknown"])).dispatchPaused,
    ).toBe(false);
  });

  it("does not pause when the host reports no providers at all", () => {
    expect(buildHostMissionControl(withProviders([])).dispatchPaused).toBe(false);
  });
});
