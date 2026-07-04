/**
 * Effect-RPC handler functions for the ForgeGraph RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 8.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  forgegraphListRevisions,
  forgegraphGetRevision,
  forgegraphCreateRevision,
  forgegraphTriggerBuild,
  forgegraphUpdateBuildStatus,
  forgegraphCreateDeployment,
  forgegraphUpdateDeploymentStatus,
  forgegraphIngestRunEvent,
  forgegraphListDeployments,
  forgegraphListBuilds,
  forgegraphApproveProdDeploy,
  forgegraphListApps,
  forgegraphListUnlinkedApps,
  forgegraphImportApp,
} from "../handlers/forgegraph.js";

export const makeForgeGraphRpcHandlers = (ctx: HandlerContext) => ({
  "forgegraph.listRevisions": ({
    payload,
  }: {
    payload: { repoId?: string; taskId?: string; limit: number };
  }) => wrapHandler(forgegraphListRevisions, ctx, payload, "forgeRevision"),

  "forgegraph.getRevision": ({
    payload,
  }: {
    payload: { repoId: string; revId: string };
  }) => wrapHandler(forgegraphGetRevision, ctx, payload, "forgeRevision"),

  "forgegraph.createRevision": ({
    payload,
  }: {
    payload: {
      repoId: string;
      revId: string;
      taskId?: string;
      taskRunId?: string;
      branch?: string;
    };
  }) => wrapHandler(forgegraphCreateRevision, ctx, payload, "forgeRevision"),

  "forgegraph.triggerBuild": ({
    payload,
  }: {
    payload: {
      revisionId: string;
      repoId: string;
      idempotencyKey: string;
      ciProvider?: string;
      taskId?: string;
    };
  }) => wrapHandler(forgegraphTriggerBuild, ctx, payload, "forgeBuild"),

  "forgegraph.updateBuildStatus": ({
    payload,
  }: {
    payload: {
      buildId: string;
      status: string;
      imageDigest?: string;
      externalJobId?: string;
    };
  }) => wrapHandler(forgegraphUpdateBuildStatus, ctx, payload, "forgeBuild"),

  "forgegraph.createDeployment": ({
    payload,
  }: {
    payload: {
      revisionId: string;
      buildId: string;
      repoId: string;
      environment: string;
      rollbackTargetId?: string;
    };
  }) => wrapHandler(forgegraphCreateDeployment, ctx, payload, "forgeDeployment"),

  "forgegraph.updateDeploymentStatus": ({
    payload,
  }: {
    payload: { deploymentId: string; status: string };
  }) => wrapHandler(forgegraphUpdateDeploymentStatus, ctx, payload, "forgeDeployment"),

  "forgegraph.ingestRunEvent": ({
    payload,
  }: {
    payload: {
      runId: string;
      repoId: string;
      revisionId: string;
      eventType: string;
      taskId?: string;
      agentId?: string;
      testStatus?: string;
      artifactRefs?: {
        type: string;
        url?: string;
        description?: string;
      }[];
    };
  }) => wrapHandler(forgegraphIngestRunEvent, ctx, payload, "forgeRunEvent"),

  "forgegraph.listDeployments": ({
    payload,
  }: {
    payload: { revisionId?: string; repoId?: string; environment?: string };
  }) => wrapHandler(forgegraphListDeployments, ctx, payload, "forgeDeployment"),

  "forgegraph.listBuilds": ({
    payload,
  }: {
    payload: { revisionId?: string };
  }) => wrapHandler(forgegraphListBuilds, ctx, payload, "forgeBuild"),

  "forgegraph.approveProdDeploy": ({
    payload,
  }: {
    payload: { dispatchItemId: string };
  }) => wrapHandler(forgegraphApproveProdDeploy, ctx, payload, "dispatchItem"),

  "forgegraph.listApps": ({
    payload: _payload,
  }: {
    payload: Record<string, never>;
  }) => wrapHandler((_ctx, _input) => forgegraphListApps(), ctx, {} as any, "forgeApp"),

  "forgegraph.listUnlinkedApps": ({
    payload,
  }: {
    payload: { workspaceId: string };
  }) => wrapHandler(forgegraphListUnlinkedApps, ctx, payload, "forgeApp"),

  "forgegraph.importApp": ({
    payload,
  }: {
    payload: { workspaceId: string; appId: string; key: string };
  }) =>
    wrapHandler(
      forgegraphImportApp as any,
      ctx,
      payload,
      "forgeApp",
    ),
});
