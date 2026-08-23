/**
 * Tablet pane layout: how many columns fit, and whether an open artifact
 * replaces the conversation or sits beside it.
 *
 * Widths are in points. The sidebar (300–380) + a readable conversation
 * (≥ 420) + a readable document (≥ 460) only coexist at ~1180pt, i.e. a
 * 13" iPad in landscape. Everything narrower is 2-pane: the artifact
 * REPLACES the conversation (push/back) — with the sidebar collapsed into a
 * drawer below 900pt (see ~/lib/tablet-layout).
 */
export type PaneMode = "two" | "three";

export interface PaneLayoutInput {
  /** Window width in points. */
  width: number;
  /** Window height in points. */
  height: number;
  /** User's toggle for landscape; ignored where three panes can't fit. */
  preferredMode: PaneMode;
  /** Whether an artifact is currently open in the stack. */
  hasArtifact: boolean;
}

export interface PaneLayout {
  /** The mode actually rendered. */
  mode: PaneMode;
  /** Three panes physically fit — the landscape toggle is meaningful. */
  canUseThreePanes: boolean;
  isLandscape: boolean;
  /** In the rendered layout, the artifact takes the conversation's slot. */
  artifactReplacesConversation: boolean;
  /** Pixel width for the artifact column when it sits beside the conversation. */
  artifactPaneWidth: number;
}

export const THREE_PANE_MIN_WIDTH = 1180;
const ARTIFACT_PANE_RATIO = 0.42;
const ARTIFACT_PANE_MIN = 460;
const ARTIFACT_PANE_MAX = 640;

export function getPaneLayout(input: PaneLayoutInput): PaneLayout {
  const isLandscape = input.width > input.height;
  const canUseThreePanes = isLandscape && input.width >= THREE_PANE_MIN_WIDTH;
  const mode: PaneMode =
    canUseThreePanes && input.preferredMode === "three" ? "three" : "two";
  const artifactReplacesConversation = input.hasArtifact && mode === "two";
  const artifactPaneWidth = Math.min(
    ARTIFACT_PANE_MAX,
    Math.max(ARTIFACT_PANE_MIN, Math.round(input.width * ARTIFACT_PANE_RATIO)),
  );
  return {
    mode,
    canUseThreePanes,
    isLandscape,
    artifactReplacesConversation,
    artifactPaneWidth,
  };
}

export function togglePaneMode(mode: PaneMode): PaneMode {
  return mode === "three" ? "two" : "three";
}
