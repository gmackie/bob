/**
 * The two settings routers must expose the same DB-backed procedures.
 *
 * `settingsRouter` is what the mobile and web clients are TYPED against;
 * `settingsEdgeRouter` is what the Cloudflare Worker actually SERVES. A
 * procedure added to only one of them typechecks, lints, unit-tests clean —
 * and then 404s for every user. That exact split cost a day on 2026-08-30
 * when agentAuth and dispatchControl shipped missing from the edge.
 *
 * The edge router is deliberately a subset: config-file procedures need
 * node:fs and cannot run on Workers. Those are listed below, so the exclusion
 * is a decision rather than an accident.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/db/client", () => ({ db: {} }));

import { settingsRouter } from "../router/settings";
import { settingsEdgeRouter } from "../router/settingsEdge";

/** Procedures that genuinely cannot run at the edge, and why. */
const NODE_ONLY: Record<string, string> = {
  listConfigRoots: "node:fs / node:os",
  listConfigEntries: "node:fs",
  readConfigFile: "node:fs",
  writeConfigFile: "node:fs",
  deleteConfigFile: "node:fs",
};

describe("settings router parity", () => {
  it("serves every edge-safe settings procedure at the edge", () => {
    const edge = new Set(Object.keys(settingsEdgeRouter));
    const missing = Object.keys(settingsRouter).filter(
      (name) => !edge.has(name) && !(name in NODE_ONLY),
    );

    expect(missing).toEqual([]);
  });

  it("serves the notification-preference procedures the mobile matrix calls", () => {
    // Named explicitly: these are what the per-type notification screen hits,
    // and a regression here silently returns that screen to "all or nothing".
    const edge = new Set(Object.keys(settingsEdgeRouter));

    expect(edge.has("listNotificationPreferences")).toBe(true);
    expect(edge.has("setNotificationPreference")).toBe(true);
    expect(edge.has("resetNotificationPreferences")).toBe(true);
  });
});
