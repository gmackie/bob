/**
 * Phone primary navigation: a tab bar.
 *
 * The menu sheet was the phone's only navigation, one tap away from every
 * screen and zero taps visible. A tab bar is the iOS pattern for the four or
 * five places a person goes constantly; everything else stays reachable behind
 * More, which opens the sheet. This model decides which is which — the layout
 * and the sheet both read it, so they cannot drift apart.
 */

import type { Href } from "expo-router";

import type { MobileNavDestination } from "./mobile-nav";
import { MOBILE_NAV_DESTINATIONS } from "./mobile-nav";

export type MobileTabKey = "home" | "tasks" | "chat" | "nodes" | "more";

/**
 * Real tabs carry a routable href (the typed-routes union when generated,
 * plain string otherwise, so no cast is needed at the call site). "More" is
 * not a route: it opens the sheet, and its pseudo-href only marks the sheet as
 * the owner of that path.
 */
export type MobileTab =
  | { key: Exclude<MobileTabKey, "more">; label: string; href: Extract<Href, string> }
  | { key: "more"; label: string; href: "/more" };

export const MOBILE_TABS: readonly MobileTab[] = [
  { key: "home", label: "Home", href: "/home" },
  { key: "tasks", label: "Tasks", href: "/tasks" },
  { key: "chat", label: "Chat", href: "/chat" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "more", label: "More", href: "/more" },
];

const TAB_HREFS = new Set(MOBILE_TABS.map((tab) => tab.href));

/** The sheet's destinations that are not tabs, in the sheet's order. */
export const MORE_DESTINATIONS: readonly MobileNavDestination[] = MOBILE_NAV_DESTINATIONS.filter(
  (destination) => !TAB_HREFS.has(destination.href),
);

/**
 * Detail routes are attributed to the tab they are reached from, so opening a
 * work item from Home does not make every tab go dark.
 */
const ROUTE_OWNERS: readonly [prefix: string, tab: MobileTabKey][] = [
  ["/home", "home"],
  ["/tasks", "tasks"],
  ["/work-items", "tasks"],
  ["/sessions", "tasks"],
  ["/providers", "tasks"],
  ["/chat", "chat"],
  ["/nodes", "nodes"],
  ["/more", "more"],
  ["/settings", "more"],
  ["/planning", "more"],
  ["/pull-requests", "more"],
  ["/notifications", "more"],
  ["/projects", "more"],
];

export function resolveTabForPath(pathname: string): MobileTabKey {
  const path = pathname.split("?")[0] ?? pathname;
  for (const [prefix, tab] of ROUTE_OWNERS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return tab;
  }
  return "home";
}

export function tabHref(key: MobileTabKey): string {
  return MOBILE_TABS.find((tab) => tab.key === key)?.href ?? "/home";
}
