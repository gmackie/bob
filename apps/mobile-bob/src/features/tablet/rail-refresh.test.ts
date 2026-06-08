import { describe, expect, it } from "vitest";

import {
  getTabletRailProjectQueryOptions,
  getTabletRailWorkItemQueryOptions,
} from "./rail-refresh";

describe("tablet rail refresh options", () => {
  it("polls priority queue rows for task priority and status changes", () => {
    expect(getTabletRailWorkItemQueryOptions(true)).toEqual({
      enabled: true,
      refetchInterval: 10_000,
    });
  });

  it("polls project rows for git and configuration changes", () => {
    expect(getTabletRailProjectQueryOptions(true)).toEqual({
      enabled: true,
      refetchInterval: 15_000,
    });
  });

  it("does not poll when the backing workspace is unavailable", () => {
    expect(getTabletRailWorkItemQueryOptions(false)).toEqual({
      enabled: false,
      refetchInterval: false,
    });
    expect(getTabletRailProjectQueryOptions(false)).toEqual({
      enabled: false,
      refetchInterval: false,
    });
  });
});
