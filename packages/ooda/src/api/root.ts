import { bobRouter } from "./router/bob";
import { conversationsRouter } from "./router/conversations";
import { contextRouter } from "./router/context";
import { eventsRouter } from "./router/events";
import { hostRouter } from "./router/host";
import { jobsRouter } from "./router/jobs";
import { integrationsRouter } from "./router/integrations";
import { memoriesRouter } from "./router/memories";
import { proposalsRouter } from "./router/proposals";
import { rolloutRouter } from "./router/rollout";
import { importsRouter } from "./router/imports";
import { oracleRouter } from "./router/oracle";
import { publishRouter } from "./router/publish";
import { researchRouter } from "./router/research";
import { runnerRouter } from "./router/runner";
import { threadsRouter } from "./router/threads";
import { vaultRouter } from "./router/vault";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  conversations: conversationsRouter,
  context: contextRouter,
  events: eventsRouter,
  host: hostRouter,
  jobs: jobsRouter,
  integrations: integrationsRouter,
  memories: memoriesRouter,
  proposals: proposalsRouter,
  rollout: rolloutRouter,
  threads: threadsRouter,
  runner: runnerRouter,
  research: researchRouter,
  vault: vaultRouter,
  publish: publishRouter,
  imports: importsRouter,
  oracle: oracleRouter,
  bob: bobRouter,
});

export type AppRouter = typeof appRouter;
