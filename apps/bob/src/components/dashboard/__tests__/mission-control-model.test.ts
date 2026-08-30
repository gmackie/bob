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

  it("passes the host's dispatch-running state through for the UI control", () => {
    const base = {
      schemaVersion: 1 as const,
      hostId: "hetzner-bob",
      daemonVersion: "dev",
      queueDepth: 0,
      checkedAt: "2026-07-11T18:00:00.000Z",
      providers: [],
    };
    const at = new Date("2026-07-11T18:00:30.000Z");

    expect(buildHostMissionControl({ ...base, dispatchRunning: true }, at).dispatchRunning).toBe(
      true,
    );
    expect(buildHostMissionControl({ ...base, dispatchRunning: false }, at).dispatchRunning).toBe(
      false,
    );
    // A daemon that predates dispatch control sends no field at all. Reporting
    // that as "stopped" would offer a Start button for a runner that may well
    // be running, so it must stay undefined.
    expect(buildHostMissionControl(base, at).dispatchRunning).toBeUndefined();
  });

  it("offers a different remedy for each way an agent can be disqualified", () => {
    // 2026-08-30: all four agents were failing for four different reasons and
    // the page called three of them Ready. Once the states are distinguished,
    // the remedies must be too — top up, sign in, or wait. Showing "Sign in"
    // for an exhausted balance is how an operator loops on the wrong action.
    const at = new Date("2026-08-30T16:00:00.000Z");
    const host = (status: string) =>
      buildHostMissionControl(
        {
          schemaVersion: 1 as const,
          hostId: "hetzner-bob",
          daemonVersion: "dev",
          queueDepth: 0,
          checkedAt: "2026-08-30T16:00:00.000Z",
          providers: [
            {
              provider: "grok",
              command: "grok",
              installed: true,
              authenticated: true,
              status,
              checkedAt: "2026-08-30T16:00:00.000Z",
              capabilities: { cancel: true, resume: false, approval: true },
            },
          ],
        } as never,
        at,
      ).providers[0];

    expect(host("no_credit")).toMatchObject({ statusLabel: "Out of credit", remedy: "top_up" });
    expect(host("unauthenticated")).toMatchObject({ remedy: "sign_in" });
    expect(host("rate_limited")).toMatchObject({ statusLabel: "Rate limited", remedy: "wait" });
    // Ready must offer no remedy at all.
    expect(host("ready").remedy).toBeNull();
  });

  it("pauses dispatch when every agent is rate limited", () => {
    // A spent quota blocks dispatch as hard as a dead credential; treating it
    // as healthy is what kept the runner claiming work it could not do.
    const model = buildHostMissionControl(
      {
        schemaVersion: 1 as const,
        hostId: "hetzner-bob",
        daemonVersion: "dev",
        queueDepth: 0,
        checkedAt: "2026-08-30T16:00:00.000Z",
        providers: [
          {
            provider: "claude",
            command: "claude",
            installed: true,
            authenticated: true,
            status: "rate_limited",
            checkedAt: "2026-08-30T16:00:00.000Z",
            capabilities: { cancel: true, resume: false, approval: true },
          },
        ],
      } as never,
      new Date("2026-08-30T16:00:00.000Z"),
    );

    expect(model.dispatchPaused).toBe(true);
  });
});
