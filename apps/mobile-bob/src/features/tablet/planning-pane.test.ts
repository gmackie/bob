import { describe, expect, it } from "vitest";

import {
  isPlanningPaneInteractiveStatus,
  isPlanningPaneStartingStatus,
} from "./planning-pane";

describe("tablet planning pane model", () => {
  it("treats active and awaiting-input planning sessions as interactive", () => {
    expect(isPlanningPaneInteractiveStatus("running")).toBe(true);
    expect(isPlanningPaneInteractiveStatus("starting")).toBe(true);
    expect(isPlanningPaneInteractiveStatus("provisioning")).toBe(true);
    expect(isPlanningPaneInteractiveStatus("pending")).toBe(true);
    expect(isPlanningPaneInteractiveStatus("awaiting-input")).toBe(true);
    expect(isPlanningPaneInteractiveStatus("awaiting_input")).toBe(true);
  });

  it("treats pending planning sessions as starting", () => {
    expect(isPlanningPaneStartingStatus("starting")).toBe(true);
    expect(isPlanningPaneStartingStatus("provisioning")).toBe(true);
    expect(isPlanningPaneStartingStatus("pending")).toBe(true);
    expect(isPlanningPaneStartingStatus("running")).toBe(false);
  });

  it("keeps completed planning sessions read-only", () => {
    expect(isPlanningPaneInteractiveStatus("completed")).toBe(false);
    expect(isPlanningPaneInteractiveStatus("stopped")).toBe(false);
    expect(isPlanningPaneInteractiveStatus("error")).toBe(false);
    expect(isPlanningPaneInteractiveStatus("unknown")).toBe(false);
  });
});
