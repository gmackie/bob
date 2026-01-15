import { authRouter } from "./router/auth";
import { chatRouter } from "./router/chat";
import { eventRouter } from "./router/event";
import { filesystemRouter } from "./router/filesystem";
import { gitRouter } from "./router/git";
import { gitProvidersRouter } from "./router/gitProviders";
import { instanceRouter } from "./router/instance";
import { kanbangerRouter } from "./router/kanbanger";
import { linkRouter } from "./router/link";
import { planRouter } from "./router/plan";
import { postRouter } from "./router/post";
import { pullRequestRouter } from "./router/pullRequest";
import { repositoryRouter } from "./router/repository";
import { sessionRouter } from "./router/session";
import { settingsRouter } from "./router/settings";
import { systemRouter } from "./router/system";
import { terminalRouter } from "./router/terminal";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  chat: chatRouter,
  event: eventRouter,
  filesystem: filesystemRouter,
  git: gitRouter,
  gitProviders: gitProvidersRouter,
  instance: instanceRouter,
  kanbanger: kanbangerRouter,
  link: linkRouter,
  plan: planRouter,
  post: postRouter,
  pullRequest: pullRequestRouter,
  repository: repositoryRouter,
  session: sessionRouter,
  settings: settingsRouter,
  system: systemRouter,
  terminal: terminalRouter,
});

export type AppRouter = typeof appRouter;
