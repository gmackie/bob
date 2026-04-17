import { createTRPCRouter } from "./trpc";
import { threadsRouter } from "./routers/threads";
import { branchesRouter } from "./routers/branches";
import { messagesRouter } from "./routers/messages";

export const appRouter = createTRPCRouter({
  threads: threadsRouter,
  branches: branchesRouter,
  messages: messagesRouter,
});

export type AppRouter = typeof appRouter;
