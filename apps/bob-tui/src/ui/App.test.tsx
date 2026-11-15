import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { emptyView, type CommandOption, type Confirmation } from "@bob/sdlc-view";

import type { SessionState } from "../client/session";
import { FIXTURE_NOW, fixtureView, PLAN_ACTIVE, PLAN_PAUSED } from "../fixtures";
import { emptyCommands } from "../model/commands";
import type { UiState } from "../model/keymap";
import { App, type SessionHandle } from "./App";

// Strip ANSI so snapshots are stable regardless of color support.
// eslint-disable-next-line no-control-regex
const plain = (s: string | undefined) => (s ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((l) => l.trimEnd()).join("\n");

function fakeSession(patch: Partial<SessionState> = {}) {
  let state: SessionState = { view: fixtureView(), commands: emptyCommands(), connection: "live", error: null, ...patch };
  const listeners = new Set<(s: SessionState) => void>();
  const sent: Array<{ option: CommandOption; label: string; confirm?: Confirmation }> = [];
  const session: SessionHandle = {
    get state() { return state; },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    send(option, label, confirm) { sent.push({ option, label, ...(confirm ? { confirm } : {}) }); return `cmd-${sent.length}`; },
    tick() {},
  };
  const push = (next: Partial<SessionState>) => { state = { ...state, ...next }; for (const l of listeners) l(state); };
  return { session, sent, push };
}

const ui = (path: UiState["path"], cursor = 0): UiState => ({ path, cursor, mode: { kind: "browse" }, message: null });
const tick = () => new Promise((r) => setTimeout(r, 20));

function mount(opts: { patch?: Partial<SessionState>; initial?: UiState; columns?: number } = {}) {
  const fake = fakeSession(opts.patch);
  const element = () => <App session={fake.session} host="bob.blder.bot" now={() => FIXTURE_NOW} tickMs={0} rows={30} {...(opts.initial ? { initial: opts.initial } : {})} />;
  const r = render(element());
  // ink-testing-library's stdout is fixed at 100 columns; widen or narrow it, then lay out again.
  Object.defineProperty(r.stdout, "columns", { get: () => opts.columns ?? 130 });
  r.rerender(element());
  return { ...fake, ...r, frame: () => plain(r.lastFrame()) };
}

describe("App frames", () => {
  it("fleet: projects, header counts and the inbox", () => {
    const { frame } = mount();
    expect(frame()).toMatchSnapshot();
    expect(frame()).toContain("coordinator online");
    expect(frame()).toContain("4 need attention");
  });

  it("repo level: plans with state badges", () => {
    const { frame } = mount({ initial: ui({ startupId: "s-bob", repoKey: "forgegraph:gmackie/bob" }) });
    expect(frame()).toMatchSnapshot();
    expect(frame()).toMatch(/plan a1c7e5f0\s+Active/);
    expect(frame()).toMatch(/plan c3e9a7b2\s+Draft/);
  });

  it("plan level: the dependency tree as an indented tree", () => {
    const { frame } = mount({ initial: ui({ startupId: "s-bob", repoKey: "forgegraph:gmackie/bob", planId: PLAN_ACTIVE }, 1) });
    expect(frame()).toMatchSnapshot();
    expect(frame()).toContain("└ BOB-72");
    expect(frame()).toContain("↑ shown above");
    expect(frame()).toContain("(needs merged)");
  });

  it("item level: state, milestones, thread and evidence", () => {
    const { frame } = mount({ initial: ui({ startupId: "s-bob", repoKey: "forgegraph:gmackie/bob", planId: PLAN_ACTIVE, itemId: "item-a1" }) });
    expect(frame()).toMatchSnapshot();
    expect(frame()).toContain("t3:thr-71");
    expect(frame()).toContain("https://git.forgegraf.com/gmackie/bob/pulls/292");
    expect(frame()).toContain("✓ exec ✓");
  });

  it("medium width puts the inbox under the panes", () => {
    const { frame } = mount({ columns: 90, initial: ui({ startupId: "s-forge", repoKey: "forgegraph:gmackie/forgegraph", planId: PLAN_PAUSED, itemId: "item-p1" }) });
    expect(frame()).toMatchSnapshot();
  });

  it("narrow terminals stack the panes and say so", () => {
    const { frame } = mount({ columns: 60 });
    expect(frame()).toContain("Terminal is 60 columns");
  });

  it("offline coordinator and reconnecting socket are shown, and commands are refused", async () => {
    const view = { ...fixtureView(), coordinatorSeenAt: FIXTURE_NOW - 7 * 60_000 };
    const r = mount({ patch: { view, connection: "reconnecting" }, initial: ui({ startupId: "s-forge", repoKey: "forgegraph:gmackie/forgegraph", planId: PLAN_PAUSED }) });
    expect(r.frame()).toContain("○ reconnecting");
    expect(r.frame()).toContain("coordinator offline since 7m ago");
    r.stdin.write("p");
    await tick();
    expect(r.sent).toHaveLength(0);
    expect(r.frame()).toContain("not connected to the SDLC edge");
  });

  it("waiting for the first snapshot", () => {
    const { frame } = mount({ patch: { view: emptyView(), connection: "connecting" } });
    expect(frame()).toContain("Waiting for the edge's first snapshot");
  });
});

describe("App keys", () => {
  it("drills with enter and backs out with esc", async () => {
    const r = mount();
    r.stdin.write("\r");
    await tick();
    expect(r.frame()).toContain("Fleet › Bob");
    r.stdin.write("\r");
    await tick();
    expect(r.frame()).toContain("Fleet › Bob › gmackie/bob");
    r.stdin.write("\u001b");
    await tick();
    expect(r.frame()).toMatch(/Fleet › Bob\s/);
  });

  it("p resumes a paused plan at once (tier 1)", async () => {
    const r = mount({ initial: ui({ startupId: "s-forge", repoKey: "forgegraph:gmackie/forgegraph" }) });
    r.stdin.write("p");
    await tick();
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.option.command).toEqual({ operation: "ControlPlan", input: { planId: PLAN_PAUSED, expectedVersion: 3, action: "resume" } });
    expect(r.sent[0]!.confirm).toBeUndefined();
  });

  it("c asks y/n (tier 2) before cancelling an item", async () => {
    const r = mount({ initial: ui({ startupId: "s-bob", repoKey: "forgegraph:gmackie/bob", planId: PLAN_ACTIVE, itemId: "item-a1" }) });
    r.stdin.write("c");
    await tick();
    expect(r.frame()).toContain("Cancel item BOB-71?");
    expect(r.sent).toHaveLength(0);
    r.stdin.write("y");
    await tick();
    expect(r.sent).toEqual([expect.objectContaining({ label: "Cancel item BOB-71", confirm: { confirmed: true } })]);
  });

  it(": opens the palette for the selection", async () => {
    const r = mount({ initial: ui({ startupId: "s-bob", repoKey: "forgegraph:gmackie/bob", planId: PLAN_ACTIVE, itemId: "item-a3" }) });
    r.stdin.write(":");
    await tick();
    expect(r.frame()).toMatchSnapshot();
  });

  it("shows command status as it moves through pending, accepted and the result", async () => {
    const r = mount({ initial: ui({ startupId: "s-forge", repoKey: "forgegraph:gmackie/forgegraph", planId: PLAN_PAUSED }) });
    const command = { type: "command" as const, commandId: "c1", operation: "ControlPlan" as const, input: { planId: PLAN_PAUSED, expectedVersion: 3, action: "resume" as const } };
    const entry = { command, label: "Resume plan plan b2d8f6a1", resourceId: PLAN_PAUSED, sentAt: FIXTURE_NOW };
    r.push({ commands: { order: ["c1"], entries: { c1: { ...entry, status: "pending" } } } });
    await tick();
    expect(r.frame()).toContain("Resume plan plan b2d8f6a1: pending");
    r.push({ commands: { order: ["c1"], entries: { c1: { ...entry, status: "accepted" } } } });
    await tick();
    expect(r.frame()).toContain("accepted, waiting for the coordinator");
    r.push({ commands: { order: ["c1"], entries: { c1: { ...entry, status: "rejected", error: "coordinator-offline: no exporter contact" } } } });
    await tick();
    expect(r.frame()).toContain("rejected (coordinator-offline");
  });
});
