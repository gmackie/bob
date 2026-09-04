/**
 * The settings index: rows that push to sub-screens.
 *
 * Settings was one 742-line scroll of six inline sections, and per-type
 * notifications add roughly eighteen more controls. A flat list stops being
 * navigable well before that — you cannot deep-link to a single setting, and
 * finding anything means scrolling past everything else.
 *
 * Every row carries its current value. An index whose rows only name a
 * destination makes you open all six to learn anything.
 */

export type SettingsRowKey =
  | "account"
  | "workspace"
  | "notifications"
  | "providers"
  | "apiKeys"
  | "appearance"
  | "device";

export interface SettingsRow {
  key: SettingsRowKey;
  label: string;
  /** The current setting, shown inline so the index answers on its own. */
  value: string;
  href: string;
  /** Draws the eye when something is wrong, e.g. a provider is not ready. */
  needsAttention: boolean;
}

export interface SettingsIndexInput {
  workspaceName: string;
  notificationSummary: string;
  providerReadyCount: number;
  providerTotalCount: number;
  apiKeyCount: number;
  theme: "light" | "dark" | "system";
}

const THEME_LABELS = { light: "Light", dark: "Dark", system: "System" } as const;

export function buildSettingsIndex(input: SettingsIndexInput): SettingsRow[] {
  const allProvidersReady = input.providerReadyCount === input.providerTotalCount;

  return [
    {
      key: "account",
      label: "Account",
      value: "",
      href: "/settings/account",
      needsAttention: false,
    },
    {
      key: "workspace",
      label: "Workspace",
      value: input.workspaceName,
      href: "/settings/workspace",
      needsAttention: false,
    },
    {
      key: "notifications",
      label: "Notifications",
      value: input.notificationSummary,
      href: "/settings/notifications",
      needsAttention: false,
    },
    {
      key: "providers",
      label: "Providers",
      // "4 ready" and "2 of 4 ready" are different situations, and the index
      // is where an operator should notice the second one.
      value: allProvidersReady
        ? `${input.providerReadyCount} ready`
        : `${input.providerReadyCount} of ${input.providerTotalCount} ready`,
      href: "/settings/providers",
      needsAttention: !allProvidersReady,
    },
    {
      key: "apiKeys",
      label: "API Keys",
      value: `${input.apiKeyCount} key${input.apiKeyCount === 1 ? "" : "s"}`,
      href: "/settings/api-keys",
      needsAttention: false,
    },
    {
      key: "device",
      label: "Device",
      value: "",
      href: "/settings/device",
      needsAttention: false,
    },
    {
      key: "appearance",
      label: "Appearance",
      value: THEME_LABELS[input.theme],
      href: "/settings/appearance",
      needsAttention: false,
    },
  ];
}
