import { describe, expect, it } from "vitest";

import {
  buildExecutionRow,
  getExecutionFilterHref,
  normalizeExecutionFilter,
} from "../executions-model";

const now = new Date("2026-10-11T18:00:00Z");

describe("executions filters", () => {
  it("maps the Autolab filter to the GenTrellis research source", () => {
    expect(normalizeExecutionFilter("gentrellis-research")).toMatchObject({
      label: "Autolab",
      source: "gentrellis-research",
    });
    expect(getExecutionFilterHref("gentrellis-research")).toBe(
      "/executions?source=gentrellis-research",
    );
  });

  it("falls back to all executions for unknown or missing filters", () => {
    for (const value of [null, undefined, "", "ooda", "all"]) {
      expect(normalizeExecutionFilter(value)).toMatchObject({ key: "all" });
      expect(normalizeExecutionFilter(value).source).toBeUndefined();
    }
  });
});

describe("buildExecutionRow", () => {
  const base = { id: "s1", title: "dd5a6b48: freeze geometry", status: "running" };

  it("links a research execution to its GenTrellis origin", () => {
    const row = buildExecutionRow(
      {
        ...base,
        dispatchSource: {
          system: "gentrellis-research",
          environment: "dronesplat-nvs",
          url: "https://console.gentrellis.com/dashboard/research?env=dronesplat-nvs",
        },
      },
      now,
    );
    expect(row.originLabel).toBe("Autolab · dronesplat-nvs");
    expect(row.originHref).toBe(
      "https://console.gentrellis.com/dashboard/research?env=dronesplat-nvs",
    );
    expect(row.href).toBe("/sessions/s1");
  });

  it("labels an inferred legacy research execution without inventing a link", () => {
    const row = buildExecutionRow(
      { ...base, dispatchSource: { system: "gentrellis-research", inferred: true } },
      now,
    );
    expect(row.originLabel).toBe("Autolab");
    expect(row.originHref).toBeNull();
  });

  it("never links a non-https origin", () => {
    const row = buildExecutionRow(
      { ...base, dispatchSource: { system: "x", url: "javascript:alert(1)" } },
      now,
    );
    expect(row.originHref).toBeNull();
  });

  it("reports a quiet running session as running, with its activity age only", () => {
    const row = buildExecutionRow(
      { ...base, lastActivityAt: "2026-10-11T15:00:00Z" },
      now,
    );
    expect(row.statusLabel).toBe("Running");
    expect(row.activityLabel).toBe("Last activity 3h ago");
    expect(row.canStop).toBe(true);
  });

  it("says contact was lost rather than calling a host_unknown session stopped or failed", () => {
    const row = buildExecutionRow({ ...base, status: "host_unknown" }, now);
    expect(row.statusLabel).toBe("Host unknown");
    expect(row.tone).toBe("warning");
    expect(row.activityLabel).toBe("Contact lost — process state unknown");
    expect(row.canStop).toBe(true);
  });

  it("offers no stop for terminal sessions and surfaces failures", () => {
    expect(buildExecutionRow({ ...base, status: "completed" }, now)).toMatchObject({
      tone: "success",
      canStop: false,
      error: null,
    });
    expect(
      buildExecutionRow({ ...base, status: "error", lastError: "push rejected" }, now),
    ).toMatchObject({ tone: "danger", canStop: false, error: "push rejected" });
  });
});
