/**
 * Live check progress, as a phone shows it.
 *
 * This is the "watch the lights turn green" surface. The runner already emits
 * structured `check` events per phase — lint, typecheck, test — carrying a
 * status and pass/fail counts. Nothing on mobile read them, so a person on the
 * road could see that a run was going but not what it was doing.
 *
 * A stream is folded into one row per phase, because a phase reports
 * repeatedly as it progresses and what a person wants is its current state,
 * not a log of every update.
 */

export type CheckTone = "green" | "red" | "amber" | "grey";

export interface CheckEventLike {
  eventType: string;
  seq: number;
  payload: Record<string, unknown>;
}

export interface CheckRow {
  phase: string;
  status: string;
  tone: CheckTone;
  /** "12 passed" or "1 failed, 3 passed" — empty when no counts were sent. */
  countsLabel: string;
}

function toneFor(status: string): CheckTone {
  if (status === "passed") return "green";
  if (status === "failed") return "red";
  if (status === "running") return "amber";
  // Includes "skipped" and anything a future runner sends. An unknown status
  // still shows its phase rather than vanishing from the list.
  return "grey";
}

function countsLabel(counts: unknown): string {
  if (!counts || typeof counts !== "object") return "";
  const { passed, failed } = counts as { passed?: number; failed?: number };
  // Failures lead: it is the number a person is looking for.
  if (typeof failed === "number" && failed > 0) {
    return typeof passed === "number"
      ? `${failed} failed, ${passed} passed`
      : `${failed} failed`;
  }
  return typeof passed === "number" ? `${passed} passed` : "";
}

export function foldCheckEvents(events: readonly CheckEventLike[]): CheckRow[] {
  const byPhase = new Map<string, CheckRow>();
  // Insertion order is the runner's dependency order. Sorting alphabetically
  // would make the list jump around as later phases arrive.
  const order: string[] = [];

  for (const event of events) {
    if (event.eventType !== "check") continue;

    const phase = event.payload.phase;
    if (typeof phase !== "string" || !phase) continue;
    // "all" is the run_finished rollup; rendering it repeats what the
    // individual phase rows already say.
    if (phase === "all") continue;

    const status = typeof event.payload.status === "string" ? event.payload.status : "running";

    if (!byPhase.has(phase)) order.push(phase);
    byPhase.set(phase, {
      phase,
      status,
      tone: toneFor(status),
      countsLabel: countsLabel(event.payload.counts),
    });
  }

  return order.map((phase) => byPhase.get(phase)!);
}
