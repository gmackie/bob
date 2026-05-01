/**
 * Edge-compatible tRPC router for OODA on Cloudflare Workers.
 *
 * Excludes routers that depend on Node.js-only APIs:
 * - vault   (ALL filesystem — git, fs)
 * - publish  (ALL filesystem — writes markdown to disk)
 * - threads  (full version) — replaced with threads-edge (DB-only subset)
 */

import type { TRPCRouterRecord } from "@trpc/server";

import { threadsEdgeRouter } from "./router/threads-edge";
import { runnerRouter } from "./router/runner";
import { researchRouter } from "./router/research";
import { importsRouter } from "./router/imports";
import { createTRPCRouter } from "./trpc";

const edgeRouterRecord = {
  threads: threadsEdgeRouter,
  runner: runnerRouter,
  research: researchRouter,
  imports: importsRouter,
} satisfies TRPCRouterRecord;

export const edgeRouter = createTRPCRouter(edgeRouterRecord);

export type EdgeRouter = typeof edgeRouter;
