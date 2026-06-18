import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root";
export { type EdgeRouter, edgeRouter } from "./edge-router";
export { createTRPCContext } from "./trpc";
export type { RouterInputs, RouterOutputs };
