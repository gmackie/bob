// ExternalRpc — wire contract for Bob external/ForgeGraph operations.
// 7B-4C Task 8: 14 external.forgegraph.* procedures.
// 7B-4C Task 9: +8 external.webhook.* + 9 external.publicApi.* procedures (31 total).
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
  WebhookConfigRecordSchema,
  WebhookDeliveryRecordSchema,
  RunStatusEnum,
  PublicApiArtifactTypeEnum,
  PublicApiRunRecordSchema,
  PublicApiArtifactRecordSchema,
  HeartbeatRepoSchema,
  WorkspaceRegistrationResultSchema,
  ApiKeyResultSchema,
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

// ---------------------------------------------------------------------------
// Webhook RPCs (7B-4C Task 9)
// ---------------------------------------------------------------------------

export const WebhookListRpc = Rpc.make("external.webhook.list", {
  payload: Schema.Struct({
    workspaceId: Schema.optional(Schema.String),
    activeOnly: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Array(WebhookConfigRecordSchema),
  error: BobNotFoundError,
});

export const WebhookByIdRpc = Rpc.make("external.webhook.byId", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.NullOr(WebhookConfigRecordSchema),
  error: BobNotFoundError,
});

export const WebhookCreateRpc = Rpc.make("external.webhook.create", {
  payload: Schema.Struct({
    workspaceId: Schema.optional(Schema.String),
    url: Schema.String,
    secret: Schema.String,
    events: Schema.optional(Schema.Array(Schema.String)),
    active: Schema.optional(Schema.Boolean),
    description: Schema.optional(Schema.String),
  }),
  success: WebhookConfigRecordSchema,
  error: BobNotFoundError,
});

export const WebhookUpdateRpc = Rpc.make("external.webhook.update", {
  payload: Schema.Struct({
    id: Schema.String,
    url: Schema.optional(Schema.String),
    secret: Schema.optional(Schema.String),
    events: Schema.optional(Schema.Array(Schema.String)),
    active: Schema.optional(Schema.Boolean),
    description: Schema.optional(Schema.String),
  }),
  success: Schema.NullOr(WebhookConfigRecordSchema),
  error: BobNotFoundError,
});

export const WebhookDeleteRpc = Rpc.make("external.webhook.delete", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  error: BobNotFoundError,
});

export const WebhookDeliveriesRpc = Rpc.make("external.webhook.deliveries", {
  payload: Schema.Struct({
    configId: Schema.String,
    limit: Schema.optional(Schema.Number),
    cursor: Schema.optional(Schema.String),
  }),
  success: Schema.Array(WebhookDeliveryRecordSchema),
  error: BobNotFoundError,
});

export const WebhookRedeliverRpc = Rpc.make("external.webhook.redeliver", {
  payload: Schema.Struct({ deliveryId: Schema.String }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  error: BobNotFoundError,
});

export const WebhookTestRpc = Rpc.make("external.webhook.testWebhook", {
  payload: Schema.Struct({ configId: Schema.String }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  error: BobNotFoundError,
});

// ---------------------------------------------------------------------------
// PublicApi RPCs (7B-4C Task 9)
// ---------------------------------------------------------------------------

export const PublicApiRegisterWorkspaceRpc = Rpc.make(
  "external.publicApi.registerWorkspace",
  {
    payload: Schema.Struct({
      name: Schema.String,
      slug: Schema.String,
      machineId: Schema.String,
      repoPath: Schema.optional(Schema.String),
    }),
    success: WorkspaceRegistrationResultSchema,
    error: BobNotFoundError,
  },
);

export const PublicApiCreateRunRpc = Rpc.make("external.publicApi.createRun", {
  payload: Schema.Struct({
    workItemId: Schema.String,
    workspaceId: Schema.String,
    agentType: Schema.String,
    agentConfig: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  success: PublicApiRunRecordSchema,
  error: BobNotFoundError,
});

export const PublicApiUpdateRunRpc = Rpc.make("external.publicApi.updateRun", {
  payload: Schema.Struct({
    runId: Schema.String,
    status: RunStatusEnum,
    summary: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  success: PublicApiRunRecordSchema,
  error: BobNotFoundError,
});

export const PublicApiCreateArtifactRpc = Rpc.make(
  "external.publicApi.createArtifact",
  {
    payload: Schema.Struct({
      runId: Schema.String,
      type: PublicApiArtifactTypeEnum,
      storageKey: Schema.String,
      metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
    success: PublicApiArtifactRecordSchema,
    error: BobNotFoundError,
  },
);

export const PublicApiGetRunRpc = Rpc.make("external.publicApi.getRun", {
  payload: Schema.Struct({ runId: Schema.String }),
  success: Schema.NullOr(PublicApiRunRecordSchema),
  error: BobNotFoundError,
});

export const PublicApiListRunsRpc = Rpc.make("external.publicApi.listRuns", {
  payload: Schema.Struct({
    workspaceId: Schema.String,
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(PublicApiRunRecordSchema),
  error: BobNotFoundError,
});

export const PublicApiListRunsByWorkItemRpc = Rpc.make(
  "external.publicApi.listRunsByWorkItem",
  {
    payload: Schema.Struct({
      workItemId: Schema.String,
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Array(PublicApiRunRecordSchema),
    error: BobNotFoundError,
  },
);

export const PublicApiHeartbeatRpc = Rpc.make("external.publicApi.heartbeat", {
  payload: Schema.Struct({
    workspaceId: Schema.String,
    agentTypes: Schema.optional(Schema.Array(Schema.String)),
    forgeAvailable: Schema.optional(Schema.Boolean),
    repos: Schema.optional(Schema.Array(HeartbeatRepoSchema)),
  }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  error: BobNotFoundError,
});

export const PublicApiGenerateApiKeyRpc = Rpc.make(
  "external.publicApi.generateApiKey",
  {
    payload: Schema.Struct({
      name: Schema.optional(Schema.String),
    }),
    success: ApiKeyResultSchema,
    error: BobNotFoundError,
  },
);

export const ExternalRpc = RpcGroup.make(
  // ForgeGraph (14)
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
  // Webhook (8)
  WebhookListRpc,
  WebhookByIdRpc,
  WebhookCreateRpc,
  WebhookUpdateRpc,
  WebhookDeleteRpc,
  WebhookDeliveriesRpc,
  WebhookRedeliverRpc,
  WebhookTestRpc,
  // PublicApi (9)
  PublicApiRegisterWorkspaceRpc,
  PublicApiCreateRunRpc,
  PublicApiUpdateRunRpc,
  PublicApiCreateArtifactRpc,
  PublicApiGetRunRpc,
  PublicApiListRunsRpc,
  PublicApiListRunsByWorkItemRpc,
  PublicApiHeartbeatRpc,
  PublicApiGenerateApiKeyRpc,
);
