import { describe, expect, it } from "vitest";

import {
  getTabletGlobalActionPosition,
  getTabletShellPadding,
  getTabletSidebarWidth,
} from "./tablet-layout";

describe("tablet layout", () => {
  it("keeps the sidebar wide enough for labels on compact iPads", () => {
    expect(getTabletSidebarWidth(744)).toBe(300);
  });

  it("caps the sidebar so the main pane keeps most of a large iPad", () => {
    expect(getTabletSidebarWidth(1366)).toBe(380);
  });

  it("uses a proportional sidebar between the minimum and maximum", () => {
    expect(getTabletSidebarWidth(1100)).toBe(330);
  });

  it("preserves safe-area padding in landscape", () => {
    expect(getTabletShellPadding({ top: 24, right: 0, bottom: 20, left: 0 })).toEqual({
      top: 24,
      right: 0,
      bottom: 20,
      left: 0,
    });
  });

  it("does not allow negative safe-area padding", () => {
    expect(getTabletShellPadding({ top: -1, right: -2, bottom: -3, left: -4 })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it("positions global actions below the safe area in tablet landscape", () => {
    expect(getTabletGlobalActionPosition({ top: 24, right: 8, bottom: 20, left: 0 })).toEqual({
      top: 36,
      right: 24,
    });
  });
});
