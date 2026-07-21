import type { TRPCRouterRecord } from "@trpc/server";

import { agentRunRouter } from "./router/agentRun";
import { authRouter } from "./router/auth";
import { billingRouter } from "./router/billing";
import { captureRouter } from "./router/capture";
import { chatRouter } from "./router/chat";
import { checkpointRouter } from "./router/checkpoint";
import { cookiesRouter } from "./router/cookies";
import { dispatchRouter } from "./router/dispatch";
import { eventRouter } from "./router/event";
import { featureBranchRouter } from "./router/featureBranch";
import { filesystemRouter } from "./router/filesystem";
import { forgegraphRouter } from "./router/forgegraph";
import { gitRouter } from "./router/git";
import { gitProvidersRouter } from "./router/gitProviders";
import { instanceRouter } from "./router/instance";
import { integrationRouter } from "./router/integration";
import { linkRouter } from "./router/link";
import { planRouter } from "./router/plan";
import { planningRouter } from "./router/planning";
import { planSessionRouter } from "./router/planSession";
import { projectRouter } from "./router/project";
import { publicApiRouter } from "./router/publicApi";
import { pullRequestRouter } from "./router/pullRequest";
import { repositoryRouter } from "./router/repository";
import { requirementRouter } from "./router/requirement";
import { secretsRouter } from "./router/secrets";
import { sessionRouter } from "./router/session";
import { settingsRouter } from "./router/settings";
import { skillRouter } from "./router/skill";
import { snapshotRouter } from "./router/snapshot";
import { systemRouter } from "./router/system";
import { terminalRouter } from "./router/terminal";
import { webhookRouter } from "./router/webhook";
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
import { workspaceRouter } from "./router/workspace";
import { createTRPCRouter } from "./trpc";

const appRouterRecord = {
  activity: activityRouter,
  agentRun: agentRunRouter,
  artifact: artifactRouter,
  auth: authRouter,
  billing: billingRouter,
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
