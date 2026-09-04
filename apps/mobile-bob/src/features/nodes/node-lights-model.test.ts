/**
 * The agent lights, as a phone shows them.
 *
 * The point of this screen is watching state change while a run is going —
 * seeing a light go green on its own. So the model has to be honest about
 * three different things a person reads at a glance: is the host reporting at
 * all, is each agent usable, and is work actually moving.
 *
 * Rules come from @bob/ws's shared provider-health model, not a copy: the web
 * dashboard, the tablet cockpit and this screen must not disagree about the
 * same agent.
 */
import { describe, expect, it } from "vitest";

import type { HostSnapshotWire } from "@bob/ws";

import { buildNodeLights } from "./node-lights-model";

const snapshot = (
  providers: { provider: string; status: string }[],
  checkedAt: string,
) =>
  ({
  schemaVersion: 1 as const,
  hostId: "hetzner-bob",
  daemonVersion: "dev",
  queueDepth: 0,
  checkedAt,
  providers: providers.map((p) => ({
    ...p,
    command: p.provider,
    installed: true,
    authenticated: p.status !== "unauthenticated",
    checkedAt,
    capabilities: { cancel: true, resume: false, approval: true },
    })),
  }) as unknown as HostSnapshotWire;

const now = new Date("2026-09-03T12:00:00Z");
const fresh = "2026-09-03T11:59:30.000Z";
const stale = "2026-09-03T11:50:00.000Z";

describe("buildNodeLights", () => {
  it("shows every agent green when the host reports them all ready", () => {
    const model = buildNodeLights(
      snapshot([{ provider: "claude", status: "ready" }, { provider: "codex", status: "ready" }], fresh),
      { activeRunCount: 0, now },
    );

    expect(model.lights.every((l) => l.tone === "green")).toBe(true);
    expect(model.allReady).toBe(true);
  });

  it("distinguishes the ways an agent can be unusable", () => {
    // Amber is "you can fix this"; red is "this cannot run". Collapsing them
    // is how an operator stops reading the colour at all.
    const model = buildNodeLights(
      snapshot(
        [
          { provider: "claude", status: "rate_limited" },
          { provider: "codex", status: "unauthenticated" },
          { provider: "grok", status: "no_credit" },
          { provider: "cursor-agent", status: "unavailable" },
        ],
        fresh,
      ),
      { activeRunCount: 0, now },
    );

    const tones = Object.fromEntries(model.lights.map((l) => [l.provider, l.tone]));
    expect(tones.claude).toBe("amber");
    expect(tones.codex).toBe("amber");
    expect(tones.grok).toBe("amber");
    expect(tones["cursor-agent"]).toBe("grey");
    expect(model.allReady).toBe(false);
  });

  it("marks the host stale when the snapshot stops arriving", () => {
    // A frozen light is worse than no light: it says "green" about a host that
    // stopped answering ten minutes ago.
    const model = buildNodeLights(snapshot([{ provider: "claude", status: "ready" }], stale), {
      activeRunCount: 0,
      now,
    });

    expect(model.isStale).toBe(true);
    expect(model.lights[0]?.tone).toBe("grey");
  });

  it("reports work in flight, which is what makes the screen worth watching", () => {
    const model = buildNodeLights(snapshot([{ provider: "claude", status: "ready" }], fresh), {
      activeRunCount: 2,
      now,
    });

    expect(model.activityLabel).toBe("2 running");
  });

  it("says idle rather than showing a zero", () => {
    const model = buildNodeLights(snapshot([{ provider: "claude", status: "ready" }], fresh), {
      activeRunCount: 0,
      now,
    });

    expect(model.activityLabel).toBe("Idle");
  });

  it("handles no snapshot yet without pretending everything is fine", () => {
    const model = buildNodeLights(null, { activeRunCount: 0, now });

    expect(model.lights).toEqual([]);
    expect(model.isStale).toBe(true);
    expect(model.allReady).toBe(false);
  });

  it("carries each agent's detail through, so the reason is on screen", () => {
    // "Out of credit" without the provider's own words sends someone to the
    // wrong remedy; the detail line is what makes the light actionable.
    const base = snapshot([{ provider: "grok", status: "no_credit" }], fresh);
    const withDetail = {
      ...base,
      providers: base.providers.map((p) => ({ ...p, detail: "402 Payment Required" })),
    };

    expect(buildNodeLights(withDetail, { activeRunCount: 0, now }).lights[0]?.detail).toBe(
      "402 Payment Required",
    );
  });
});
