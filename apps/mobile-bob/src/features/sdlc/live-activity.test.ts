import type { LiveActivityContent, LiveActivityRegistration } from "@bob/sdlc-view";
import { emptyView, reduce } from "@bob/sdlc-view";
import { describe, expect, it } from "vitest";

import { contentFor, createLiveActivityController } from "./live-activity";
import type { LiveActivityNative } from "./live-activity";
import { item, must, plan, TOPOLOGY } from "./test-fixtures";

const ignore = () => undefined;
const subscription = { remove: ignore };

const TOKEN = "ab".repeat(32);

function fakeNative(over: Partial<LiveActivityNative> = {}) {
  const calls: string[] = [];
  let onToken: ((e: { itemId: string; token: string }) => void) | null = null;
  let onEnded: ((e: { itemId: string }) => void) | null = null;
  const native: LiveActivityNative = {
    appId: () => "com.gmacko.bob.dev",
    isSupported: () => true,
    activeItemIds: () => [],
    tokens: () => ({}),
    start: (itemId) => { calls.push(`start ${itemId}`); return Promise.resolve("a1"); },
    update: (itemId, state) => { calls.push(`update ${itemId} ${state.state}`); return Promise.resolve(); },
    end: (itemId) => { calls.push(`end ${itemId}`); return Promise.resolve(); },
    onPushToken: (l) => { onToken = l; return subscription; },
    onEnded: (l) => { onEnded = l; return subscription; },
    ...over,
  };
  return { native, calls, token: (itemId: string, token: string) => onToken?.({ itemId, token }), ended: (itemId: string) => onEnded?.({ itemId }) };
}

const view = (state: "running" | "validating") =>
  reduce(emptyView(), { type: "snapshot", epoch: "e1", seq: 1, plans: [plan("p1", [{ itemId: "i1", state }])], items: [item("p1", { itemId: "i1", state })], topology: TOPOLOGY, coordinatorSeenAt: 5 } as never);

describe("Live Activity controller (GMA-774)", () => {
  it("registers the token with the app's bundle id once following, and stops on end", async () => {
    const f = fakeNative();
    const sent: LiveActivityRegistration[] = [];
    const c = createLiveActivityController(f.native, (r) => sent.push(r));
    f.token("i1", TOKEN); // not followed: ignored
    await c.follow("i1", must(contentFor(view("running"), "i1"), "content"));
    f.token("i1", TOKEN);
    expect(sent).toEqual([{ type: "liveActivity", itemId: "i1", token: TOKEN, app: "com.gmacko.bob.dev" }]);
    f.ended("i1");
    expect(sent.at(-1)).toEqual({ type: "liveActivity", itemId: "i1", token: null, app: "com.gmacko.bob.dev" });
    expect(c.following().has("i1")).toBe(false);
  });

  it("re-sends tokens of activities running before a reload; omits an unknown app id", () => {
    const f = fakeNative({ appId: () => "com.other", activeItemIds: () => ["i1"], tokens: () => ({ i1: TOKEN, i9: TOKEN }) });
    const sent: LiveActivityRegistration[] = [];
    const c = createLiveActivityController(f.native, (r) => sent.push(r));
    expect(sent).toEqual([{ type: "liveActivity", itemId: "i1", token: TOKEN }]);
    expect(c.following().has("i1")).toBe(true);
  });

  it("updates followed activities from the view only when their content changed", async () => {
    const f = fakeNative();
    const c = createLiveActivityController(f.native, ignore);
    await c.follow("i1", must(contentFor(view("running"), "i1"), "content"));
    c.viewChanged(view("running"));
    c.viewChanged(view("validating"));
    c.viewChanged(view("validating"));
    expect(f.calls).toEqual(["start i1", "update i1 validating"]);
  });

  it("stop() tells the edge and ends the activity; unsupported does nothing", async () => {
    const f = fakeNative();
    const sent: LiveActivityRegistration[] = [];
    const c = createLiveActivityController(f.native, (r) => sent.push(r));
    await c.follow("i1", { state: "running" } as LiveActivityContent);
    await c.stop("i1");
    expect(sent).toEqual([{ type: "liveActivity", itemId: "i1", token: null, app: "com.gmacko.bob.dev" }]);
    expect(f.calls).toEqual(["start i1", "end i1"]);
    const u = fakeNative({ isSupported: () => false });
    const off = createLiveActivityController(u.native, ignore);
    await off.follow("i1", { state: "running" } as LiveActivityContent);
    expect(u.calls).toEqual([]);
    expect(off.supported).toBe(false);
  });
});
