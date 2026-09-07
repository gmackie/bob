import type { Href } from "expo-router";

/**
 * Phone navigation.
 *
 * `/chat` is the authenticated home (getAuthenticatedHomeHref always returns
 * it), so the chat header's "Back" had nothing to pop and router.back() was a
 * silent no-op — the button rendered, did nothing, and left the phone with no
 * route to any other screen. Every other surface was reachable only through
 * TabletSidebar, so on a phone the app was one screen deep with no way out.
 */

export interface MobileNavDestination {
  href: Extract<Href, string>;
  label: string;
  description: string;
}

export const MOBILE_NAV_DESTINATIONS: readonly MobileNavDestination[] = [
  { href: "/home", label: "Home", description: "What needs you right now" },
  { href: "/chat", label: "Chat", description: "Talk to the agent" },
  { href: "/tasks", label: "Tasks", description: "Queue and outcomes" },
  { href: "/planning", label: "Planning", description: "Shape and plan work" },
  {
    href: "/pull-requests",
    label: "Pull requests",
    description: "Review and merge",
  },
  { href: "/nodes", label: "Nodes", description: "Agent and machine health" },
  {
    href: "/notifications",
    label: "Notifications",
    description: "Recent activity",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Account, providers, alerts",
  },
];

/**
 * The leading header slot. On the home screen there is no history to pop, so
 * offering "Back" is a dead control; surface the navigation menu instead.
 */
export function resolveHeaderLeadingAction(input: {
  canGoBack: boolean;
}): "back" | "menu" {
  return input.canGoBack ? "back" : "menu";
}

/** Marks the destination matching the current route so the sheet can show it. */
export function markActiveDestination(
  pathname: string,
): (MobileNavDestination & { isActive: boolean })[] {
  return MOBILE_NAV_DESTINATIONS.map((d) => ({
    ...d,
    isActive: pathname === d.href || pathname.startsWith(`${d.href}/`),
  }));
}

/**
 * Below this width a split layout leaves two unusable columns. iPad Split View
 * and Slide Over hand an app a phone-width window, and an iPad in portrait is
 * narrow too — so `Platform.isPad` alone is not enough to decide. This is the
 * canonical threshold; the settings shell reuses it so the root layout and the
 * settings pane never disagree about what "tablet" means.
 */
export const SPLIT_MIN_WIDTH = 700;

/**
 * Which shell to render. The root layout used to branch on Platform.isPad
 * alone, so an iPad in portrait got the full split-pane in a phone-width
 * window.
 */
export function shouldUseSplitPaneLayout(input: {
  isTablet: boolean;
  width: number;
}): boolean {
  return input.isTablet && input.width >= SPLIT_MIN_WIDTH;
}
