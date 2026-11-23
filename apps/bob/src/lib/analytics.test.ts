import { afterEach, describe, expect, it, vi } from "vitest";

import { identifyUser, resetUser, track } from "./analytics";

type TestGlobal = { window?: { dataflare?: unknown } };
const g = globalThis as TestGlobal;

afterEach(() => {
  delete g.window;
});

describe("analytics helper", () => {
  it("no-ops without window or the loader", () => {
    expect(() => track("project_created")).not.toThrow();
    g.window = {};
    expect(() => track("work_item_dispatched")).not.toThrow();
    expect(() => identifyUser("u1")).not.toThrow();
    expect(() => resetUser()).not.toThrow();
  });

  it("passes event names, ids and props through", () => {
    const api = { track: vi.fn(), identify: vi.fn(), reset: vi.fn() };
    g.window = { dataflare: api };
    track("plan_committed", { tasks: 3 });
    track("pull_request_merged");
    identifyUser("user_1");
    identifyUser("");
    resetUser();
    expect(api.track.mock.calls).toEqual([
      ["plan_committed", { tasks: 3 }],
      ["pull_request_merged", {}],
    ]);
    expect(api.identify.mock.calls).toEqual([["user_1", {}]]);
    expect(api.reset).toHaveBeenCalledOnce();
  });

  it("swallows loader errors", () => {
    const boom = () => {
      throw new Error("boom");
    };
    g.window = { dataflare: { track: boom, identify: boom, reset: boom } };
    expect(() => track("project_created")).not.toThrow();
    expect(() => identifyUser("u1")).not.toThrow();
    expect(() => resetUser()).not.toThrow();
  });
});
