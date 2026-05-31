const SIDEBAR_MIN_WIDTH = 300;
const SIDEBAR_MAX_WIDTH = 380;
const SIDEBAR_WIDTH_RATIO = 0.3;

interface TabletSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function getTabletSidebarWidth(screenWidth: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(screenWidth * SIDEBAR_WIDTH_RATIO)),
  );
}

export function getTabletShellPadding(insets: TabletSafeAreaInsets): TabletSafeAreaInsets {
  return {
    top: Math.max(0, insets.top),
    right: Math.max(0, insets.right),
    bottom: Math.max(0, insets.bottom),
    left: Math.max(0, insets.left),
  };
}
