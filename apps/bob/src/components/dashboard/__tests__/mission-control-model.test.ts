import { describe, expect, it } from "vitest";

import { buildHostMissionControl, getMissionControlSections } from "../mission-control-model";

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
});
