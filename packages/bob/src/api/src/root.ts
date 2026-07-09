import type { TRPCRouterRecord } from "@trpc/server";

import { agentRunRouter } from "./router/agentRun";
import { authRouter } from "./router/auth";
import { captureRouter } from "./router/capture";
import { cookiesRouter } from "./router/cookies";
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
import { integrationRouter } from "./router/integration";
import { planningRouter } from "./router/planning";
import { planSessionRouter } from "./router/planSession";
import { linkRouter } from "./router/link";
import { planRouter } from "./router/plan";
import { projectRouter } from "./router/project";
import { publicApiRouter } from "./router/publicApi";
import { pullRequestRouter } from "./router/pullRequest";
import { requirementRouter } from "./router/requirement";
import { repositoryRouter } from "./router/repository";
import { secretsRouter } from "./router/secrets";
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
import { usageRouter } from "./router/usage";
import { webhookRouter } from "./router/webhook";
import { workspaceRouter } from "./router/workspace";
import { createTRPCRouter } from "./trpc";

const appRouterRecord = {
  activity: activityRouter,
  agentRun: agentRunRouter,
  artifact: artifactRouter,
  auth: authRouter,
  capture: captureRouter,
  chat: chatRouter,
  checkpoint: checkpointRouter,
  comment: commentRouter,
  cookies: cookiesRouter,
  dispatch: dispatchRouter,
  event: eventRouter,
  featureBranch: featureBranchRouter,
  filesystem: filesystemRouter,
  forgegraph: forgegraphRouter,
  git: gitRouter,
  gitProviders: gitProvidersRouter,
  instance: instanceRouter,
  integration: integrationRouter,
  planning: planningRouter,
  planSession: planSessionRouter,
  link: linkRouter,
  plan: planRouter,
  project: projectRouter,
  publicApi: publicApiRouter,
  pullRequest: pullRequestRouter,
  requirement: requirementRouter,
  repository: repositoryRouter,
  secrets: secretsRouter,
  session: sessionRouter,
  skill: skillRouter,
  snapshot: snapshotRouter,
  settings: settingsRouter,
  system: systemRouter,
  taskRun: taskRunRouter,
  terminal: terminalRouter,
  notification: notificationRouter,
  usage: usageRouter,
  workItem: workItemRouter,
  workItems: workItemsRouter,
  webhook: webhookRouter,
  workspace: workspaceRouter,
} satisfies TRPCRouterRecord;

export const appRouter = createTRPCRouter(appRouterRecord);

export type AppRouter = typeof appRouter;
