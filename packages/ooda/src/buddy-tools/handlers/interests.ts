// Standing-interest handlers.
//
// The agent schema uses a human-friendly `cadence: "daily" | "weekly" |
// "monthly"` enum. The database stores `cadenceSeconds: integer`. We do
// the translation here — if a future cadence option ("hourly",
// "quarterly") lands, only this file changes.

import { ToolHandlerError } from "../handler";
import type { ToolHandler } from "../handler";

const CADENCE_TO_SECONDS: Record<"daily" | "weekly" | "monthly", number> = {
  daily: 86_400,
  weekly: 604_800,
  monthly: 2_592_000,
};

function cadenceFromSeconds(
  seconds: number,
): "daily" | "weekly" | "monthly" {
  // Approximate back to the nearest bucket so the agent always sees one
  // of the three cadence enum values it knows about. Anything below a day
  // gets clamped to "daily" — we expect the tRPC minimum of 300s to
  // rarely show up in practice, but we stay lenient.
  if (seconds >= CADENCE_TO_SECONDS.monthly) return "monthly";
  if (seconds >= CADENCE_TO_SECONDS.weekly) return "weekly";
  return "daily";
}

function computeNextRunAt(cadenceSeconds: number, from: Date = new Date()): string {
  return new Date(from.getTime() + cadenceSeconds * 1000).toISOString();
}

export const interest_register: ToolHandler<"interest_register"> = async (
  args,
  ctx,
) => {
  const cadenceSeconds = CADENCE_TO_SECONDS[args.cadence];
  const r = await ctx.trpc.research.interestRegister({
    label: args.label,
    queryTerms: args.query_terms,
    seedSourceIds: args.seed_source_ids ?? [],
    cadenceSeconds,
    threadId: args.thread_id ?? ctx.threadId,
    enabled: true,
  });
  return {
    id: r.id,
    cadence: args.cadence,
    // The insert doesn't return next_run_at (lastRunAt is null on fresh
    // rows). Synthesize it from "now + cadence" so the agent gets a
    // stable, non-null value to report back to the user.
    next_run_at: computeNextRunAt(cadenceSeconds),
  };
};

export const interest_list: ToolHandler<"interest_list"> = async (
  args,
  ctx,
) => {
  // `.output(z.any())` on the router → inferred `any`; restore the
  // `standing_interest` row shape so the `.map` callback below types.
  const r = (await ctx.trpc.research.interestList({
    threadId: args.thread_id,
  })) as {
    items: {
      id: string;
      label: string;
      queryTerms: string[];
      cadenceSeconds: number;
      lastRunAt: Date | null;
      enabled: boolean;
      threadId: string | null;
    }[];
  };
  return {
    interests: r.items.map((row) => ({
      id: row.id,
      label: row.label,
      query_terms: row.queryTerms ?? [],
      cadence: cadenceFromSeconds(row.cadenceSeconds ?? 0),
      enabled: row.enabled,
      last_run_at:
        row.lastRunAt instanceof Date
          ? row.lastRunAt.toISOString()
          : (row.lastRunAt ?? null),
      next_run_at:
        row.enabled && row.lastRunAt instanceof Date
          ? computeNextRunAt(row.cadenceSeconds, row.lastRunAt)
          : null,
      thread_id: row.threadId ?? null,
    })),
  };
};

export const interest_disable: ToolHandler<"interest_disable"> = async (
  args,
  ctx,
) => {
  const r = await ctx.trpc.research.interestDisable({ id: args.id });
  if (!r) {
    // tRPC throws NOT_FOUND directly, but guard defensively against a
    // caller that captures and returns undefined.
    throw new ToolHandlerError(
      "NOT_FOUND",
      `standing interest ${args.id} not found`,
    );
  }
  return {
    id: r.id,
    disabled_at: new Date().toISOString(),
  };
};
