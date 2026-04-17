import { createTRPCRouter } from "./trpc";
import { threadsRouter } from "./routers/threads";
import { branchesRouter } from "./routers/branches";
import { messagesRouter } from "./routers/messages";
import { agentRouter } from "./routers/agent";
import { wikiRouter } from "./routers/wiki";

export const appRouter = createTRPCRouter({
  threads: threadsRouter,
  branches: branchesRouter,
  messages: messagesRouter,
  agent: agentRouter,
  wiki: wikiRouter,
});

export type AppRouter = typeof appRouter;
