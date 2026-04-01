/**
 * Edge-compatible tRPC router for blder.bot on Cloudflare Workers.
 *
 * Excludes routers that depend on Node.js-only APIs:
 * - capture (child_process, fs)
 * - settings (node:fs, node:os, node:path for local config files)
 * - git (imports @bob/execution-lib)
 * - terminal (pty, WebSocket server)
 * - system (execSync for host dependency checks)
 */

import type { TRPCRouterRecord } from "@trpc/server";

import { agentRunRouter } from "@bob/api/router/agentRun";
import { authRouter } from "@bob/api/router/auth";
import { cookiesRouter } from "@bob/api/router/cookies";
import { checkpointRouter } from "@bob/api/router/checkpoint";
import { chatRouter } from "@bob/api/router/chat";
import { dispatchRouter } from "@bob/api/router/dispatch";
import { eventRouter } from "@bob/api/router/event";
import { featureBranchRouter } from "@bob/api/router/featureBranch";
import { forgegraphRouter } from "@bob/api/router/forgegraph";
import { filesystemRouter } from "@bob/api/router/filesystem";
import { gitProvidersRouter } from "@bob/api/router/gitProviders";
import { instanceRouter } from "@bob/api/router/instance";
import { planningRouter } from "@bob/api/router/planning";
import { planSessionRouter } from "@bob/api/router/planSession";
import { linkRouter } from "@bob/api/router/link";
import { planRouter } from "@bob/api/router/plan";
import { postRouter } from "@bob/api/router/post";
import { projectRouter } from "@bob/api/router/project";
import { publicApiRouter } from "@bob/api/router/publicApi";
import { pullRequestRouter } from "@bob/api/router/pullRequest";
import { requirementRouter } from "@bob/api/router/requirement";
import { repositoryRouter } from "@bob/api/router/repository";
import { sessionRouter } from "@bob/api/router/session";
import { skillRouter } from "@bob/api/router/skill";
import { snapshotRouter } from "@bob/api/router/snapshot";
import {
  activityRouter,
  artifactRouter,
  commentRouter,
  notificationRouter,
  taskRunRouter,
  workItemRouter,
  workItemsRouter,
} from "@bob/api/router/workItems";
import { webhookRouter } from "@bob/api/router/webhook";
import { workspaceRouter } from "@bob/api/router/workspace";
import { createTRPCRouter } from "@bob/api/trpc";

const edgeRouterRecord = {
  activity: activityRouter,
  agentRun: agentRunRouter,
  artifact: artifactRouter,
  auth: authRouter,
  chat: chatRouter,
  checkpoint: checkpointRouter,
  comment: commentRouter,
  cookies: cookiesRouter,
  dispatch: dispatchRouter,
  event: eventRouter,
  featureBranch: featureBranchRouter,
  filesystem: filesystemRouter,
  forgegraph: forgegraphRouter,
  gitProviders: gitProvidersRouter,
  instance: instanceRouter,
  planning: planningRouter,
  planSession: planSessionRouter,
  link: linkRouter,
  plan: planRouter,
  post: postRouter,
  project: projectRouter,
  publicApi: publicApiRouter,
  pullRequest: pullRequestRouter,
  requirement: requirementRouter,
  repository: repositoryRouter,
  session: sessionRouter,
  skill: skillRouter,
  snapshot: snapshotRouter,
  taskRun: taskRunRouter,
  notification: notificationRouter,
  workItem: workItemRouter,
  workItems: workItemsRouter,
  webhook: webhookRouter,
  workspace: workspaceRouter,
} satisfies TRPCRouterRecord;

export const edgeRouter = createTRPCRouter(edgeRouterRecord);

export type EdgeRouter = typeof edgeRouter;
