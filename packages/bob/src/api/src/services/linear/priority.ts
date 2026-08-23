/**
 * Tracker priority → Bob's `queueSortOrder` (ascending = dispatched sooner).
 *
 * Without this, auto-drain ordered purely by `queueSortOrder` (0 for every
 * imported card) then age, so a newly filed card could not be expedited: on
 * 2026-08-23 "Fix controlsFoundry CI" — the card unblocking every merge in
 * that repo — sat undispatched behind ~60 older items with no way to say
 * "this one next".
 *
 * Linear/Kanbanger priority: 0 = none, 1 = urgent, 2 = high, 3 = medium,
 * 4 = low. Note 0 means UNSET, not "highest" — mapping it naively would make
 * every unprioritized card outrank every explicit one. Unset sorts as normal
 * (between medium and low) so only deliberate choices move a card.
 */
export const QUEUE_ORDER_BY_PRIORITY: Record<number, number> = {
  1: 10, // urgent
  2: 20, // high
  3: 30, // medium
  0: 40, // none / unset — the default lane
  4: 50, // low — explicitly deprioritized, below unset
};

export const DEFAULT_QUEUE_ORDER = 40;

export function queueOrderForPriority(priority: number | null | undefined): number {
  if (priority == null || !Number.isFinite(priority)) return DEFAULT_QUEUE_ORDER;
  return QUEUE_ORDER_BY_PRIORITY[Math.trunc(priority)] ?? DEFAULT_QUEUE_ORDER;
}
