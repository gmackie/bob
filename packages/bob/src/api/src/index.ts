import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

/**
 * Inference helpers for input types
 * @example
 * type PostByIdInput = RouterInputs['post']['byId']
 *      ^? { id: number }
 */
type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types
 * @example
 * type AllPostsOutput = RouterOutputs['post']['all']
 *      ^? Post[]
 */
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root";
export {
  workItemsRestOperationByPath,
  workItemsRestOperations,
} from "./contracts/work-items-rest";
export { createTRPCContext } from "./trpc";
export {
  checkRateLimit,
  getRateLimitPolicy,
  rateLimitKeyForRequest,
  rateLimitResponse,
  setRateLimitHeaders,
} from "./rate-limit";
export type {
  RateLimitOptions,
  RateLimitPolicy,
  RateLimitProfile,
  RateLimitResult,
} from "./rate-limit";
export type { RouterInputs, RouterOutputs };
