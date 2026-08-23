import type { TabletShellMode } from "~/features/tablet/shell";

export type HomeMode = "ooda-first" | "bob-first";
export const DEFAULT_HOME_MODE: HomeMode = "ooda-first";
export const HOME_MODE_STORAGE_KEY = "bob.homeMode";

export type PhoneTab = "inbox" | "ooda" | "bob";

export function parseHomeMode(raw: unknown): HomeMode {
  if (typeof raw !== "string") return DEFAULT_HOME_MODE;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "ooda-first" || normalized === "ooda") return "ooda-first";
  if (normalized === "bob-first" || normalized === "bob") return "bob-first";
  return DEFAULT_HOME_MODE;
}

export function defaultTabletShellMode(mode: HomeMode): TabletShellMode {
  return mode === "bob-first" ? "tasks" : "ooda";
}

export function tabletModeOrder(mode: HomeMode): TabletShellMode[] {
  return mode === "bob-first" ? ["tasks", "planning", "ooda"] : ["ooda", "planning", "tasks"];
}

export function phoneTabOrder(mode: HomeMode): PhoneTab[] {
  return mode === "bob-first" ? ["inbox", "bob", "ooda"] : ["inbox", "ooda", "bob"];
}

/** Phone home is always triage, regardless of mode. */
export function defaultPhoneTab(_mode: HomeMode): PhoneTab {
  return "inbox";
}
