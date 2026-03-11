import type { TRPCRouterRecord } from "@trpc/server";

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
import { projectRouter } from "./router/project";
import { pullRequestRouter } from "./router/pullRequest";
import { repositoryRouter } from "./router/repository";
import { sessionRouter } from "./router/session";
import { settingsRouter } from "./router/settings";
import { systemRouter } from "./router/system";
import { terminalRouter } from "./router/terminal";
import {
  artifactRouter,
  commentRouter,
  notificationRouter,
  taskRunRouter,
  workItemRouter,
  workItemsRouter,
} from "./router/workItems";
import { workspaceRouter } from "./router/workspace";
import { createTRPCRouter } from "./trpc";

const appRouterRecord = {
  artifact: artifactRouter,
  auth: authRouter,
  chat: chatRouter,
  comment: commentRouter,
  event: eventRouter,
  filesystem: filesystemRouter,
  git: gitRouter,
  gitProviders: gitProvidersRouter,
  instance: instanceRouter,
  kanbanger: kanbangerRouter,
  link: linkRouter,
  plan: planRouter,
  post: postRouter,
  project: projectRouter,
  pullRequest: pullRequestRouter,
  repository: repositoryRouter,
  session: sessionRouter,
  settings: settingsRouter,
  system: systemRouter,
  taskRun: taskRunRouter,
  terminal: terminalRouter,
  notification: notificationRouter,
  workItem: workItemRouter,
  workItems: workItemsRouter,
  workspace: workspaceRouter,
} satisfies TRPCRouterRecord;

export const appRouter = createTRPCRouter(appRouterRecord);

export type AppRouter = typeof appRouter;
