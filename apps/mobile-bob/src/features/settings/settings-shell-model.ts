/**
 * One settings definition, two shells.
 *
 * The phone and the tablet are different jobs. The phone is for review on the
 * road: one thing at a time, pushed and popped, glanceable. The tablet is for
 * working sessions, where a person wants the list and the detail on screen
 * together and expects to move between sections without losing their place.
 *
 * The SECTIONS are the same on both, and duplicating them is how two surfaces
 * drift until a setting exists on one device and not the other. So this
 * registry is shared and each shell decides only presentation.
 */

// Canonical threshold lives with the navigation model so the root layout and
// this pane cannot disagree about what counts as tablet-width.
import { SPLIT_MIN_WIDTH } from "~/features/navigation/mobile-nav";

export type SettingsSectionKey =
  | "account"
  | "workspace"
  | "notifications"
  | "providers"
  | "apiKeys"
  | "appearance"
  | "device";

export interface SettingsSection {
  key: SettingsSectionKey;
  slug: string;
  label: string;
  /** One line of what lives here, shown on the tablet rail where there is room. */
  blurb: string;
  route: string;
}

function section(
  key: SettingsSectionKey,
  slug: string,
  label: string,
  blurb: string,
): SettingsSection {
  return { key, slug, label, blurb, route: `/settings/${slug}` };
}

/** Ordered by how often a person changes them, not alphabetically. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  section("account", "account", "Account", "Sign out or delete your account"),
  section("workspace", "workspace", "Workspace", "Choose the workspace you are working in"),
  section(
    "notifications",
    "notifications",
    "Notifications",
    "Choose which events reach you, and how",
  ),
  section("providers", "providers", "Providers", "Agent capacity, limits and outcomes"),
  section("apiKeys", "api-keys", "API Keys", "Create and revoke keys for the public API"),
  section("appearance", "appearance", "Appearance", "Theme and display"),
  // Carried over from the tablet pane this replaced; dropping it in the swap
  // would have quietly removed a surface the tablet already had.
  section("device", "device", "Device", "This device's registration and push token"),
];


export interface ShellInput {
  isTablet: boolean;
  width: number;
}

export interface SettingsShell {
  mode: "stack" | "split";
  showsDetailAlongsideList: boolean;
  /**
   * What the tablet's detail pane opens on. A split layout with an empty right
   * half looks broken; the phone opens on the list itself and selects nothing.
   */
  initialSection: SettingsSectionKey | null;
}

export function resolveSettingsShell({ isTablet, width }: ShellInput): SettingsShell {
  const split = isTablet && width >= SPLIT_MIN_WIDTH;
  return {
    mode: split ? "split" : "stack",
    showsDetailAlongsideList: split,
    initialSection: split ? SETTINGS_SECTIONS[0]!.key : null,
  };
}

/** Route → section, so a deep link selects the right pane on tablet. */
export function sectionForRoute(route: string): SettingsSection | null {
  const path = route.split("?")[0]!.replace(/\/+$/, "");
  return SETTINGS_SECTIONS.find((s) => s.route === path) ?? null;
}
