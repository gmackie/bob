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
import { oracleRouter } from "./router/oracle";
import { importsRouter } from "./router/imports";
import { bobRouter } from "./router/bob";
import { conversationsRouter } from "./router/conversations";
import { eventsRouter } from "./router/events";
import { hostRouter } from "./router/host";
import { jobsRouter } from "./router/jobs";
import { integrationsRouter } from "./router/integrations";
import { proposalsRouter } from "./router/proposals";
import { createTRPCRouter } from "./trpc";

const edgeRouterRecord = {
  conversations: conversationsRouter,
  events: eventsRouter,
  host: hostRouter,
  jobs: jobsRouter,
  integrations: integrationsRouter,
  proposals: proposalsRouter,
  threads: threadsEdgeRouter,
  runner: runnerRouter,
  research: researchRouter,
  imports: importsRouter,
  oracle: oracleRouter,
  // bob.dispatch is a pure fetch() to Bob's public API (no Node fs), so it is
  // edge-safe and belongs on the worker that the thread UI actually talks to.
  bob: bobRouter,
} satisfies TRPCRouterRecord;

export const edgeRouter = createTRPCRouter(edgeRouterRecord);

export type EdgeRouter = typeof edgeRouter;
