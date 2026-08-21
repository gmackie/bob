// Cron probe: is the autonomous dispatcher starved? See services/health/starvation.
import { and, eq, inArray, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, taskRuns, workItems } from "@bob/db/schema";

import { paceDailyBudget } from "../services/health/pacing.js";
import { detectStarvation } from "../services/health/starvation.js";
import type {StarvationVerdict} from "../services/health/starvation.js";

const ACTIVE = ["pending", "provisioning", "starting", "running", "blocked", "stopping", "host_unknown"];

export interface StarvationReport extends StarvationVerdict {
  dispatchable: number;
  executeToday: number;
  dailyCap: number;
  activeSessions: number;
  concurrency: number;
  minutesSinceLastExecute: number | null;
}

export async function checkStarvation(opts: {
  windowMs?: number;
  fallbackConcurrency?: number;
  fallbackDailyCap?: number;
  pacing?: boolean;
}): Promise<StarvationReport> {
  const windowMs = opts.windowMs ?? 2 * 60 * 60 * 1000;
  const cfgRow = await db.query.autoDrainConfig.findFirst();
  const concurrency = cfgRow?.concurrency ?? opts.fallbackConcurrency ?? 4;
  const dailyCap = cfgRow?.dailyCap ?? opts.fallbackDailyCap ?? 20;

  const [[d], [a], [t]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(workItems)
      .where(and(eq(workItems.kind, "task"), inArray(workItems.status, ["ready", "todo"]))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(chatConversations)
      .where(inArray(chatConversations.status, ACTIVE)),
    db
      .select({
        n: sql<number>`count(*)::int`,
        last: sql<string | null>`max(${taskRuns.createdAt})::text`,
      })
      .from(taskRuns)
      .where(
        sql`${taskRuns.createdAt} >= date_trunc('day', now())
          and coalesce(${taskRuns.runPhase}, 'execute') = 'execute'`,
      ),
  ]);

  const lastMs = t?.last ? new Date(t.last.replace(" ", "T") + (t.last.includes("+") ? "" : "Z")).getTime() : NaN;
  const msSince = Number.isFinite(lastMs) ? Date.now() - lastMs : Infinity;

  const now = new Date();
  const paced = paceDailyBudget({
    dailyCap,
    executeToday: t?.n ?? 0,
    minuteOfDay: now.getUTCHours() * 60 + now.getUTCMinutes(),
    burst: concurrency,
  });
  const verdict = detectStarvation({
    dispatchable: d?.n ?? 0,
    executeToday: t?.n ?? 0,
    dailyCap,
    activeSessions: a?.n ?? 0,
    concurrency,
    msSinceLastExecute: msSince,
    windowMs,
    pacedAllowance: opts.pacing === false ? undefined : paced.allowance,
  });
  return {
    ...verdict,
    dispatchable: d?.n ?? 0,
    executeToday: t?.n ?? 0,
    dailyCap,
    activeSessions: a?.n ?? 0,
    concurrency,
    minutesSinceLastExecute: Number.isFinite(msSince) ? Math.round(msSince / 60000) : null,
  };
}
