// What the confirmation sheet asks for, per command tier (see tierOf in @bob/sdlc-view):
// tier 1 sends at once, tier 2 needs an explicit confirm, tier 3 needs the expected text
// typed exactly. The edge re-checks with confirmationSatisfies; this only shapes the sheet.
import { confirmationSatisfies   } from "@bob/sdlc-view";
import type {CommandOption, Confirmation} from "@bob/sdlc-view";

export interface ConfirmPrompt {
  title: string;
  body: string;
  /** Tier 3: what the user must type exactly. */
  expected: string | null;
  confirmLabel: string;
  destructive: boolean;
}

/** The sheet for a tier 2 or 3 option ("Cancel item BOB-71 in plan 1a2b3c4d?"); tier 1 needs none. */
export function confirmPrompt(option: CommandOption, target: string): ConfirmPrompt | null {
  if (option.tier === 1) return null;
  return {
    title: `${option.label} ${target}?`,
    body: option.destructive ? "This cannot be undone from Bob." : "The coordinator runs this as you.",
    expected: option.tier === 3 ? (option.expected ?? null) : null,
    confirmLabel: option.label,
    destructive: !!option.destructive,
  };
}

/**
 * The confirm field for the ClientCommand: undefined for tier 1, null when the sheet's
 * input does not satisfy the tier (the confirm button stays disabled). A tier 3 option
 * without an expected text can never be confirmed.
 */
export function confirmationFor(option: CommandOption, typed = ""): Confirmation | undefined | null {
  if (option.tier === 1) return undefined;
  const confirm: Confirmation = option.tier === 3 ? { confirmed: true, typed } : { confirmed: true };
  if (option.tier === 3 && !option.expected) return null;
  return confirmationSatisfies(option.tier, confirm, option.expected) ? confirm : null;
}

export const planTarget = (planId: string) => `plan ${planId.slice(0, 8)}`;
export const itemTarget = (itemTitle: string, planId: string) => `${itemTitle} in ${planTarget(planId)}`;
