/**
 * Edge-compatible tRPC router for bob.blder.bot on Cloudflare Workers.
 *
 * Excludes routers that depend on Node.js-only APIs:
 * - capture (child_process, fs)
 * - settings (full version uses node:fs — settingsEdge used instead)
 * - git (imports @bob/execution-lib)
 * - terminal (pty, WebSocket server)
 * - system (execSync for host dependency checks)
 */

import type { TRPCRouterRecord } from "@trpc/server";

import { agentAuthRouter } from "@bob/api/router/agentAuth";
import { agentRunRouter } from "@bob/api/router/agentRun";
import { authRouter } from "@bob/api/router/auth";
import { billingRouter } from "@bob/api/router/billing";
import { cockpitRouter } from "@bob/api/router/cockpit";
import { cookiesRouter } from "@bob/api/router/cookies";
import { checkpointRouter } from "@bob/api/router/checkpoint";
import { chatRouter } from "@bob/api/router/chat";
import { dispatchRouter } from "@bob/api/router/dispatch";
import { dispatchControlRouter } from "@bob/api/router/dispatchControl";
import { eventRouter } from "@bob/api/router/event";
import { featureBranchRouter } from "@bob/api/router/featureBranch";
import { forgegraphRouter } from "@bob/api/router/forgegraph";
import { filesystemRouter } from "@bob/api/router/filesystem";
import { gitProvidersRouter } from "@bob/api/router/gitProviders";
import { instanceRouter } from "@bob/api/router/instance";
import { integrationRouter } from "@bob/api/router/integration";
import { planningRouter } from "@bob/api/router/planning";
import { planSessionRouter } from "@bob/api/router/planSession";
import { linkRouter } from "@bob/api/router/link";
import { planRouter } from "@bob/api/router/plan";
import { projectRouter } from "@bob/api/router/project";
import { publicApiRouter } from "@bob/api/router/publicApi";
import { pullRequestRouter } from "@bob/api/router/pullRequest";
import { requirementRouter } from "@bob/api/router/requirement";
import { repositoryRouter } from "@bob/api/router/repository";
import { sessionRouter } from "@bob/api/router/session";
import { skillRouter } from "@bob/api/router/skill";
import { snapshotRouter } from "@bob/api/router/snapshot";
import { usageRouter } from "@bob/api/router/usage";
import {
  activityRouter,
  artifactRouter,
  commentRouter,
  notificationRouter,
  taskRunRouter,
  workItemRouter,
  workItemsRouter,
  publicWorkItemsRouter,
} from "@bob/api/router/workItems";
import { secretsRouter } from "@bob/api/router/secrets";
import { settingsEdgeRouter } from "@bob/api/router/settingsEdge";
import { webhookRouter } from "@bob/api/router/webhook";
import { workspaceRouter } from "@bob/api/router/workspace";
import { createTRPCRouter } from "@bob/api/trpc";

const edgeRouterRecord = {
  activity: activityRouter,
  // Both are edge-safe: they authorise the caller, then relay to the
  // ws-gateway over fetch. Neither touches a Node-only API.
  agentAuth: agentAuthRouter,
  agentRun: agentRunRouter,
  artifact: artifactRouter,
  auth: authRouter,
  // Neither touches a Node-only API; both were simply never registered,
  // so they 404'd in production exactly like agentAuth did.
  billing: billingRouter,
  chat: chatRouter,
  checkpoint: checkpointRouter,
  cockpit: cockpitRouter,
  comment: commentRouter,
  cookies: cookiesRouter,
  dispatch: dispatchRouter,
  dispatchControl: dispatchControlRouter,
  event: eventRouter,
  featureBranch: featureBranchRouter,
  filesystem: filesystemRouter,
  forgegraph: forgegraphRouter,
  gitProviders: gitProvidersRouter,
  instance: instanceRouter,
  integration: integrationRouter,
  planning: planningRouter,
  planSession: planSessionRouter,
  link: linkRouter,
  plan: planRouter,
  project: projectRouter,
  publicApi: publicApiRouter,
  publicWorkItems: publicWorkItemsRouter,
  pullRequest: pullRequestRouter,
  requirement: requirementRouter,
  repository: repositoryRouter,
  secrets: secretsRouter,
  session: sessionRouter,
  settings: settingsEdgeRouter,
  skill: skillRouter,
  snapshot: snapshotRouter,
  taskRun: taskRunRouter,
  usage: usageRouter,
  notification: notificationRouter,
  workItem: workItemRouter,
  workItems: workItemsRouter,
  webhook: webhookRouter,
  workspace: workspaceRouter,
} satisfies TRPCRouterRecord;

export const edgeRouter = createTRPCRouter(edgeRouterRecord);

export type EdgeRouter = typeof edgeRouter;
