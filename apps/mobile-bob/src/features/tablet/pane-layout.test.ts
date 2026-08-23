import { describe, expect, it } from "vitest";

import { getPaneLayout, togglePaneMode, THREE_PANE_MIN_WIDTH } from "./pane-layout";

describe("getPaneLayout", () => {
  it("offers three panes only in landscape at >= 1180pt (13\" iPad)", () => {
    const wide = getPaneLayout({ width: 1366, height: 1024, preferredMode: "three", hasArtifact: true });
    expect(wide.canUseThreePanes).toBe(true);
    expect(wide.mode).toBe("three");
    expect(wide.artifactReplacesConversation).toBe(false);
    expect(wide.isLandscape).toBe(true);
  });

  it("honors the user's 2-pane preference even when three would fit", () => {
    const wide = getPaneLayout({ width: 1366, height: 1024, preferredMode: "two", hasArtifact: true });
    expect(wide.canUseThreePanes).toBe(true);
    expect(wide.mode).toBe("two");
    expect(wide.artifactReplacesConversation).toBe(true);
  });

  it("forces two panes in portrait regardless of preference", () => {
    const portrait = getPaneLayout({ width: 1024, height: 1366, preferredMode: "three", hasArtifact: true });
    expect(portrait.canUseThreePanes).toBe(false);
    expect(portrait.mode).toBe("two");
    expect(portrait.isLandscape).toBe(false);
    expect(portrait.artifactReplacesConversation).toBe(true);
  });

  it("forces two panes on 11\" landscape (too narrow for three)", () => {
    const air = getPaneLayout({ width: 1180 - 1, height: 820, preferredMode: "three", hasArtifact: true });
    expect(air.canUseThreePanes).toBe(false);
    expect(air.mode).toBe("two");
    expect(THREE_PANE_MIN_WIDTH).toBe(1180);
  });

  it("never reports the artifact replacing the conversation when none is open", () => {
    const l = getPaneLayout({ width: 1024, height: 1366, preferredMode: "two", hasArtifact: false });
    expect(l.artifactReplacesConversation).toBe(false);
  });

  it("clamps the artifact column width to a readable range", () => {
    expect(getPaneLayout({ width: 1366, height: 1024, preferredMode: "three", hasArtifact: true }).artifactPaneWidth).toBe(574);
    expect(getPaneLayout({ width: 2000, height: 1000, preferredMode: "three", hasArtifact: true }).artifactPaneWidth).toBe(640);
    expect(getPaneLayout({ width: 1000, height: 900, preferredMode: "three", hasArtifact: true }).artifactPaneWidth).toBe(460);
  });
});

describe("togglePaneMode", () => {
  it("flips between two and three", () => {
    expect(togglePaneMode("two")).toBe("three");
    expect(togglePaneMode("three")).toBe("two");
  });
});
