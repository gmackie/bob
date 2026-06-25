/**
 * Effect-RPC handler functions for the skill RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 3.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  skillList,
  skillStats,
  skillSeed,
  skillGetExecution,
  skillListExecutions,
  skillRecordExecution,
  skillUpdateExecution,
} from "../handlers/skill.js";

export const makeSkillRpcHandlers = (ctx: HandlerContext) => ({
  "skill.list": ({
    payload,
  }: {
    payload?: Parameters<typeof skillList>[1];
  }) => wrapHandler(skillList, ctx, payload, "skill"),

  "skill.stats": () =>
    wrapHandler(
      (ctx: HandlerContext) => skillStats(ctx),
      ctx,
      undefined as unknown as void,
      "skill",
    ),

  "skill.seed": ({ payload }: { payload: void }) =>
    wrapHandler(
      (ctx: HandlerContext) => skillSeed(ctx),
      ctx,
      undefined as unknown as void,
      "skill",
    ),

  "skill.getExecution": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(skillGetExecution, ctx, payload, "skill"),

  "skill.listExecutions": ({
    payload,
  }: {
    payload: {
      sessionId?: string;
      workItemId?: string;
    };
  }) => wrapHandler(skillListExecutions, ctx, payload, "skill"),

  "skill.recordExecution": ({
    payload,
  }: {
    payload: {
      sessionId?: string;
      skillId?: string;
      skillSlug: string;
      workItemId?: string;
      parentExecutionId?: string;
      status?: "running" | "completed" | "failed" | "cancelled";
      input?: Record<string, unknown>;
    };
  }) => wrapHandler(skillRecordExecution, ctx, payload, "skill"),

  "skill.updateExecution": ({
    payload,
  }: {
    payload: {
      id: string;
      status?: "running" | "completed" | "failed" | "cancelled";
      output?: Record<string, unknown>;
      findings?: unknown[];
      completedAt?: Date;
      durationMs?: number;
    };
  }) => wrapHandler(skillUpdateExecution, ctx, payload, "skill"),
});
