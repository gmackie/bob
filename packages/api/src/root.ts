import type { TRPCRouterRecord } from "@trpc/server";

import { authRouter } from "./router/auth";
import { captureRouter } from "./router/capture";
import { checkpointRouter } from "./router/checkpoint";
import { chatRouter } from "./router/chat";
import { dispatchRouter } from "./router/dispatch";
import { eventRouter } from "./router/event";
import { featureBranchRouter } from "./router/featureBranch";
import { forgegraphRouter } from "./router/forgegraph";
import { filesystemRouter } from "./router/filesystem";
import { gitRouter } from "./router/git";
import { gitProvidersRouter } from "./router/gitProviders";
import { instanceRouter } from "./router/instance";
import { planningRouter } from "./router/planning";
import { planSessionRouter } from "./router/planSession";
import { linkRouter } from "./router/link";
import { planRouter } from "./router/plan";
import { postRouter } from "./router/post";
import { projectRouter } from "./router/project";
import { pullRequestRouter } from "./router/pullRequest";
import { requirementRouter } from "./router/requirement";
import { repositoryRouter } from "./router/repository";
import { sessionRouter } from "./router/session";
import { skillRouter } from "./router/skill";
import { snapshotRouter } from "./router/snapshot";
import { settingsRouter } from "./router/settings";
import { systemRouter } from "./router/system";
import { terminalRouter } from "./router/terminal";
import {
  activityRouter,
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
  activity: activityRouter,
  artifact: artifactRouter,
  auth: authRouter,
  capture: captureRouter,
  chat: chatRouter,
  checkpoint: checkpointRouter,
  comment: commentRouter,
  dispatch: dispatchRouter,
  event: eventRouter,
  featureBranch: featureBranchRouter,
  filesystem: filesystemRouter,
  forgegraph: forgegraphRouter,
  git: gitRouter,
  gitProviders: gitProvidersRouter,
  instance: instanceRouter,
  planning: planningRouter,
  planSession: planSessionRouter,
  link: linkRouter,
  plan: planRouter,
  post: postRouter,
  project: projectRouter,
  pullRequest: pullRequestRouter,
  requirement: requirementRouter,
  repository: repositoryRouter,
  session: sessionRouter,
  skill: skillRouter,
  snapshot: snapshotRouter,
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
