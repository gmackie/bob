// ExternalRpc — wire contract for Bob external/ForgeGraph operations.
// 7B-4C Task 8: 14 external.forgegraph.* procedures.
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { BobNotFoundError, BobForbiddenError } from "../errors.js";
import {
  RevisionRecordSchema,
  RevisionDetailSchema,
  BuildRecordSchema,
  DeploymentRecordSchema,
  ForgeAppRecordSchema,
  RunEventRecordSchema,
  ArtifactRefSchema,
  ImportedProjectRecordSchema,
} from "../schemas/external.js";

export const ExternalListRevisionsRpc = Rpc.make(
  "external.forgegraph.listRevisions",
  {
    payload: Schema.Struct({
      repoId: Schema.optional(Schema.String),
      taskId: Schema.optional(Schema.String),
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Array(RevisionRecordSchema),
    error: BobNotFoundError,
  },
);

export const ExternalGetRevisionRpc = Rpc.make(
  "external.forgegraph.getRevision",
  {
    payload: Schema.Struct({
      repoId: Schema.String,
      revId: Schema.String,
    }),
    success: RevisionDetailSchema,
    error: BobNotFoundError,
  },
);

export const ExternalCreateRevisionRpc = Rpc.make(
  "external.forgegraph.createRevision",
  {
    payload: Schema.Struct({
      repoId: Schema.String,
      revId: Schema.String,
      taskId: Schema.optional(Schema.String),
      taskRunId: Schema.optional(Schema.String),
      branch: Schema.optional(Schema.String),
    }),
    success: RevisionRecordSchema,
    error: BobNotFoundError,
  },
);

export const ExternalTriggerBuildRpc = Rpc.make(
  "external.forgegraph.triggerBuild",
  {
    payload: Schema.Struct({
      revisionId: Schema.String,
      repoId: Schema.String,
      idempotencyKey: Schema.String,
      ciProvider: Schema.optional(Schema.String),
      taskId: Schema.optional(Schema.String),
    }),
    success: Schema.NullOr(BuildRecordSchema),
    error: BobNotFoundError,
  },
);

export const ExternalUpdateBuildStatusRpc = Rpc.make(
  "external.forgegraph.updateBuildStatus",
  {
    payload: Schema.Struct({
      buildId: Schema.String,
      status: Schema.String,
      imageDigest: Schema.optional(Schema.String),
      externalJobId: Schema.optional(Schema.String),
    }),
    success: Schema.NullOr(BuildRecordSchema),
    error: BobNotFoundError,
  },
);

export const ExternalCreateDeploymentRpc = Rpc.make(
  "external.forgegraph.createDeployment",
  {
    payload: Schema.Struct({
      revisionId: Schema.String,
      buildId: Schema.String,
      repoId: Schema.String,
      environment: Schema.String,
      rollbackTargetId: Schema.optional(Schema.String),
    }),
    success: DeploymentRecordSchema,
    error: BobNotFoundError,
  },
);

export const ExternalUpdateDeploymentStatusRpc = Rpc.make(
  "external.forgegraph.updateDeploymentStatus",
  {
    payload: Schema.Struct({
      deploymentId: Schema.String,
      status: Schema.String,
    }),
    success: Schema.NullOr(DeploymentRecordSchema),
    error: BobNotFoundError,
  },
);

export const ExternalIngestRunEventRpc = Rpc.make(
  "external.forgegraph.ingestRunEvent",
  {
    payload: Schema.Struct({
      runId: Schema.String,
      repoId: Schema.String,
      revisionId: Schema.String,
      eventType: Schema.String,
      taskId: Schema.optional(Schema.String),
      agentId: Schema.optional(Schema.String),
      testStatus: Schema.optional(Schema.String),
      artifactRefs: Schema.optional(Schema.Array(ArtifactRefSchema)),
    }),
    success: RunEventRecordSchema,
    error: BobNotFoundError,
  },
);

export const ExternalListDeploymentsRpc = Rpc.make(
  "external.forgegraph.listDeployments",
  {
    payload: Schema.Struct({
      revisionId: Schema.optional(Schema.String),
      repoId: Schema.optional(Schema.String),
      environment: Schema.optional(Schema.String),
    }),
    success: Schema.Array(DeploymentRecordSchema),
    error: BobNotFoundError,
  },
);

export const ExternalListBuildsRpc = Rpc.make(
  "external.forgegraph.listBuilds",
  {
    payload: Schema.Struct({
      revisionId: Schema.optional(Schema.String),
    }),
    success: Schema.Array(BuildRecordSchema),
    error: BobNotFoundError,
  },
);

export const ExternalApproveProdDeployRpc = Rpc.make(
  "external.forgegraph.approveProdDeploy",
  {
    payload: Schema.Struct({
      dispatchItemId: Schema.String,
    }),
    success: DeploymentRecordSchema,
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

export const ExternalListAppsRpc = Rpc.make("external.forgegraph.listApps", {
  payload: Schema.Void,
  success: Schema.Array(ForgeAppRecordSchema),
  error: BobNotFoundError,
});

export const ExternalListUnlinkedAppsRpc = Rpc.make(
  "external.forgegraph.listUnlinkedApps",
  {
    payload: Schema.Struct({
      workspaceId: Schema.String,
    }),
    success: Schema.Array(ForgeAppRecordSchema),
    error: BobNotFoundError,
  },
);

export const ExternalImportAppRpc = Rpc.make(
  "external.forgegraph.importApp",
  {
    payload: Schema.Struct({
      workspaceId: Schema.String,
      appId: Schema.String,
      key: Schema.String,
    }),
    success: ImportedProjectRecordSchema,
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

export const ExternalRpc = RpcGroup.make(
  ExternalListRevisionsRpc,
  ExternalGetRevisionRpc,
  ExternalCreateRevisionRpc,
  ExternalTriggerBuildRpc,
  ExternalUpdateBuildStatusRpc,
  ExternalCreateDeploymentRpc,
  ExternalUpdateDeploymentStatusRpc,
  ExternalIngestRunEventRpc,
  ExternalListDeploymentsRpc,
  ExternalListBuildsRpc,
  ExternalApproveProdDeployRpc,
  ExternalListAppsRpc,
  ExternalListUnlinkedAppsRpc,
  ExternalImportAppRpc,
);
