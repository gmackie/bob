/**
 * Effect-RPC handler functions for the daily plan RPCs.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  dailyPlanApprove,
  dailyPlanClose,
  dailyPlanGenerate,
  dailyPlanGet,
  dailyPlanList,
} from "../handlers/dailyPlan.js";

export const makeDailyPlanRpcHandlers = (ctx: HandlerContext) => ({
  "dailyPlan.get": ({
    payload,
  }: {
    payload: { workspaceId: string; planDate?: string };
  }) => wrapHandler(dailyPlanGet, ctx, payload, "dailyPlan"),

  "dailyPlan.list": ({
    payload,
  }: {
    payload: { workspaceId: string; limit?: number };
  }) => wrapHandler(dailyPlanList, ctx, payload, "dailyPlan"),

  "dailyPlan.generate": ({
    payload,
  }: {
    payload: { workspaceId: string; planDate?: string };
  }) => wrapHandler(dailyPlanGenerate, ctx, payload, "dailyPlan"),

  "dailyPlan.approve": ({
    payload,
  }: {
    payload: { planId: string; workItemIds?: readonly string[] };
  }) => wrapHandler(dailyPlanApprove, ctx, payload, "dailyPlan"),

  "dailyPlan.close": ({ payload }: { payload: { planId: string } }) =>
    wrapHandler(dailyPlanClose, ctx, payload, "dailyPlan"),
});
