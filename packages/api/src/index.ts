import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

/**
 * Inference helpers for input types
 * @example
 * type WorkItemListInput = RouterInputs['workItems']['list']
 */
type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types
 * @example
 * type WorkItemListOutput = RouterOutputs['workItems']['list']
 */
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root";
export {
  workItemsRestOperationByPath,
  workItemsRestOperations,
} from "./contracts/work-items-rest";
export { createTRPCContext } from "./trpc";
export type { RouterInputs, RouterOutputs };
