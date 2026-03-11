import { router } from "../trpc";
import { authRouter } from "./auth";
import { userRouter } from "./user";
import { workspaceRouter } from "./workspace";
import { teamRouter } from "./team";
import { projectRouter } from "./project";
import { projectGroupRouter } from "./project-group";
import { issueRouter } from "./issue";
import { commentRouter } from "./comment";
import { labelRouter } from "./label";
import { cycleRouter } from "./cycle";
import { notificationRouter } from "./notification";
import { integrationRouter } from "./integration";
import { viewRouter, favoriteRouter } from "./view";
import { dependencyRouter } from "./dependency";
import { outboundWebhookRouter } from "./outbound-webhook";
import { projectDocumentRouter } from "./project-document";
import { agentRouter } from "./agent";
import { mobileRouter } from "./mobile";
import { issueArtifactRouter } from "./issue-artifact";
import { forgeRepositoryRouter } from "./forge-repository";
import { forgeRevisionRouter } from "./forge-revision";
import { forgeRunRouter } from "./forge-run";
import { forgeBuildRouter } from "./forge-build";
import { forgeDeploymentRouter } from "./forge-deployment";
import { forgeGraphV1Router } from "./forgegraph-v1";

export const appRouter = router({
  auth: authRouter,
  user: userRouter,
  workspace: workspaceRouter,
  team: teamRouter,
  project: projectRouter,
  projectGroup: projectGroupRouter,
  issue: issueRouter,
  comment: commentRouter,
  label: labelRouter,
  cycle: cycleRouter,
  notification: notificationRouter,
  integration: integrationRouter,
  view: viewRouter,
  favorite: favoriteRouter,
  dependency: dependencyRouter,
  outboundWebhook: outboundWebhookRouter,
  projectDocument: projectDocumentRouter,
  agent: agentRouter,
  mobile: mobileRouter,
  issueArtifact: issueArtifactRouter,
  forgeRepository: forgeRepositoryRouter,
  forgeRevision: forgeRevisionRouter,
  forgeRun: forgeRunRouter,
  forgeBuild: forgeBuildRouter,
  forgeDeployment: forgeDeploymentRouter,
  forgeGraphV1: forgeGraphV1Router,
});

export type AppRouter = typeof appRouter;
