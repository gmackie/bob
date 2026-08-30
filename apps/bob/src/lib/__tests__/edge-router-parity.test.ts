/**
 * The edge worker serves `edgeRouter`, but the browser client is typed against
 * the full `AppRouter` (see trpc/react.tsx — deliberate, so UI compiles against
 * the eventual server target). That combination is a silent production trap: a
 * router registered in root.ts but not in edge-router.ts typechecks, lints and
 * unit-tests clean, then 404s for every user.
 *
 * It bit on 2026-08-30. agentAuth and dispatchControl shipped to production
 * missing, so the whole point of the credential UI — a Sign in button that
 * works — was a 404, with nothing anywhere reporting a failure.
 *
 * So: every router in the app router must be either exposed at the edge or
 * listed below as a deliberate exclusion, with the reason it cannot run there.
 */
import { describe, expect, it } from "vitest";

import { appRouter } from "@bob/api";

import { edgeRouter } from "../edge-router";

/**
 * Routers that genuinely cannot run on Workers, and why. Adding to this list is
 * a decision about a Node-only dependency, not a way to quiet the test —
 * anything edge-safe belongs in edge-router.ts instead.
 */
const NODE_ONLY: Record<string, string> = {
  capture: "child_process, fs",
  git: "imports @bob/execution-lib",
  terminal: "pty and a WebSocket server",
  system: "execSync for host dependency checks",
  settings: "node:fs; settingsEdge is served in its place",
};

/**
 * Edge-safe routers that are nonetheless absent from the worker — the same
 * silent 404 as agentAuth, found by this test on 2026-08-30 and left as-is
 * because fixing them is a separate change with its own verification. Neither
 * imports a Node-only API, so both are omissions rather than decisions.
 *
 * Pinned exactly, so the set can only shrink: a NEW router that skips the edge
 * fails the test rather than joining a growing list of quiet 404s.
 */
const KNOWN_EDGE_GAPS = ["billing", "usage"];

function routerKeys(router: unknown): string[] {
  const record = (router as { _def: { record: Record<string, unknown> } })._def.record;
  return Object.keys(record).sort();
}

describe("edge router parity", () => {
  it("exposes every app router that is not a documented Node-only exclusion", () => {
    const edge = new Set(routerKeys(edgeRouter));
    const missing = routerKeys(appRouter).filter((k) => !edge.has(k) && !(k in NODE_ONLY));

    // Exact, not a superset check: a new omission must fail here even while
    // the known gaps remain.
    expect(missing).toEqual(KNOWN_EDGE_GAPS);
  });

  it("serves the routers the agent credential UI calls", () => {
    // Named explicitly: these are what the Sign in and Start/Stop buttons hit.
    // A regression here takes the UI back to "SSH into the host".
    const edge = new Set(routerKeys(edgeRouter));

    expect(edge.has("agentAuth")).toBe(true);
    expect(edge.has("dispatchControl")).toBe(true);
  });
});
