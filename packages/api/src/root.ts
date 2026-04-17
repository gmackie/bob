import { createTRPCRouter } from "./trpc";
import { threadsRouter } from "./routers/threads";
import { branchesRouter } from "./routers/branches";
import { messagesRouter } from "./routers/messages";
import { agentRouter } from "./routers/agent";

export const appRouter = createTRPCRouter({
  threads: threadsRouter,
  branches: branchesRouter,
  messages: messagesRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;
