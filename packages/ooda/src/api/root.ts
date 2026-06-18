import { importsRouter } from "./router/imports";
import { oracleRouter } from "./router/oracle";
import { publishRouter } from "./router/publish";
import { researchRouter } from "./router/research";
import { runnerRouter } from "./router/runner";
import { threadsRouter } from "./router/threads";
import { vaultRouter } from "./router/vault";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  threads: threadsRouter,
  runner: runnerRouter,
  research: researchRouter,
  vault: vaultRouter,
  publish: publishRouter,
  imports: importsRouter,
  oracle: oracleRouter,
});

export type AppRouter = typeof appRouter;
