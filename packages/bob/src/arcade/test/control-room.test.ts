import { describe, expect, it } from "vitest";
import type { TrackedIssue } from "@bob/sdlc-view";

import * as arcade from "../src";
import type { Beat, BoardRow, RecordedBeat } from "../src";
import { snapshot, viewOf } from "./fixtures";

const now = 100_000;
const beat = (id: string, kind: Beat["kind"], itemId?: string, at = now): RecordedBeat => ({
  id,
  kind,
  at,
  receivedAt: at,
  epoch: "e",
  seq: 1,
  source: "sdlc",
  subject: { itemId },
});
const project = (projectId: string, kanbanger = true): Pick<BoardRow, "projectId" | "kanbanger"> => ({
  projectId,
  kanbanger,
});

describe("the Arcade control room", () => {
  it("keeps simultaneous agent, CI and shipping signals independent and in scope", () => {
    const agent = beat("typing", "agent.activity", "one");
    const ci = beat("checks", "ci.phase", "one");
    const release = { ...beat("ship", "milestone", "one"), data: { milestone: "production-verified" } };
    const other = beat("other", "ci.green", "two");
    const gap = beat("gap", "gap");
    const frame = arcade.controlRoomFeed([other, gap, agent, ci, release], now, new Set(["one"]));
    expect(frame.agent).toBe(agent);
    expect(frame.ci).toBe(ci);
    expect(frame.shipment).toBe(release);
    expect(frame.events).toEqual([gap, ci, release]);
  });

  it("makes plain terminal output readable without burying CI or revealing other projects", () => {
    const active = beat("typing", "agent.activity", "one");
    const busy = beat("elsewhere", "agent.activity", "two");
    const pending = beat("checks", "ci.phase", "one");
    const scope = new Set(["one"]);
    expect(arcade.controlRoomFeed([busy, active], now, scope).events).toEqual([active]);
    expect(arcade.controlRoomFeed([busy, active, pending], now, scope).events).toEqual([pending]);
  });

  it("animates new socket deliveries once even when the source clock is delayed or ahead", () => {
    const log = arcade.createBeatLog();
    const late = beat("late", "ci.green", "one", now - 30_000);
    const ahead = beat("ahead", "agent.activity", "one", now + 30_000);
    log.push([late, ahead], now);
    const frame = arcade.controlRoomFeed(log.recent(), now);
    expect(frame.ci?.id).toBe(late.id);
    expect(frame.agent?.id).toBe(ahead.id);
    expect(log.recent()[0]?.at).toBe(ahead.at);
    log.push([late, ahead], now + 3000);
    expect(arcade.controlRoomFeed(log.recent(), now + 3000)).toMatchObject({ ci: null, agent: null });
  });

  it("keeps settled history readable without replaying motion or treating every milestone as a shipment", () => {
    const old = beat("old", "agent.action", "one", now - 15_000);
    const tested = { ...beat("tested", "milestone", "one"), data: { milestone: "execution-succeeded" } };
    expect(arcade.controlRoomFeed([tested, old], now)).toMatchObject({
      agent: null,
      ci: null,
      shipment: null,
      events: [tested, old],
    });
    expect(arcade.controlRoomFeed([], now)).toEqual({
      agent: null,
      ci: null,
      shipment: null,
      events: [],
    });
  });

  it("scopes work, desk watches and issues to the selected board row, including repository fallback rows", () => {
    const view = viewOf(
      snapshot([
        { itemId: "a", state: "running", repo: "shared" },
        { itemId: "b", state: "validating", repo: "shared" },
      ]),
    );
    const plan = view.plans.p1!;
    const defs = plan.definition.items.map((d) =>
      d.itemId === "b" ? { ...d, issue: { ...d.issue, projectId: "unknown" } } : d,
    );
    const tracked: TrackedIssue = {
      id: "iss-a",
      key: "A-1",
      title: "First",
      url: null,
      state: { name: "Started", type: "started" },
      project: { id: "p", name: "Alpha" },
      team: null,
      updatedAt: now,
      pr: null,
      dispatchable: false,
      version: 1,
    };
    const all = {
      ...view,
      plans: { p1: { ...plan, definition: { ...plan.definition, items: defs } } },
      issues: { "iss-a": tracked },
    };
    expect(arcade.boardProjectView(all, null)).toBe(all);
    const alpha = arcade.boardProjectView(all, project("p"));
    expect(Object.keys(alpha.items)).toEqual(["a"]);
    expect(Object.keys(alpha.issues)).toEqual(["iss-a"]);
    expect(arcade.chooseDesks(alpha, [])).toEqual(["a"]);
    const fallback = arcade.boardProjectView(all, project("repo:shared", false));
    expect(Object.keys(fallback.items)).toEqual(["b"]);
    expect(Object.keys(fallback.issues)).toEqual([]);
    expect(arcade.hud(fallback).ci).toBe(1);
  });
});
