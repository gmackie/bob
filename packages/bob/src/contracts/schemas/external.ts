// Effect Schema definitions for Bob external/ForgeGraph domain objects.
// Translated from Zod schemas in packages/bob/src/api/src/router/forgegraph.ts
// and DB schema in packages/bob/src/ci/src/schema.ts.
// 7B-4C Task 8.
import { Schema } from "effect";

export const RevisionRecordSchema = Schema.Struct({
  id: Schema.String,
  repoId: Schema.String,
  revId: Schema.String,
  taskId: Schema.optional(Schema.NullOr(Schema.String)),
  taskRunId: Schema.optional(Schema.NullOr(Schema.String)),
  branch: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

export const BuildRecordSchema = Schema.Struct({
  id: Schema.String,
  revisionId: Schema.String,
  repoId: Schema.optional(Schema.String),
  status: Schema.String,
  idempotencyKey: Schema.optional(Schema.String),
  ciProvider: Schema.optional(Schema.NullOr(Schema.String)),
  externalJobId: Schema.optional(Schema.NullOr(Schema.String)),
  imageDigest: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
});

export const DeploymentRecordSchema = Schema.Struct({
  id: Schema.String,
  revisionId: Schema.String,
  buildId: Schema.String,
  repoId: Schema.String,
  environment: Schema.String,
  status: Schema.String,
  rollbackTargetId: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
});

export const ForgeAppRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  flakeRef: Schema.optional(Schema.NullOr(Schema.String)),
  healthCheckUrl: Schema.optional(Schema.NullOr(Schema.String)),
  deploymentPlatform: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
});

export const ArtifactRefSchema = Schema.Struct({
  type: Schema.String,
  url: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
});

export const RunEventRecordSchema = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  repoId: Schema.String,
  revisionId: Schema.String,
  eventType: Schema.String,
  taskId: Schema.optional(Schema.NullOr(Schema.String)),
  agentId: Schema.optional(Schema.NullOr(Schema.String)),
  testStatus: Schema.optional(Schema.NullOr(Schema.String)),
  artifactRefs: Schema.optional(Schema.Array(ArtifactRefSchema)),
  createdAt: Schema.optional(Schema.String),
});

// getRevision returns a revision with nested builds, deployments, runEvents.
export const RevisionDetailSchema = Schema.NullOr(
  Schema.Struct({
    id: Schema.String,
    repoId: Schema.String,
    revId: Schema.String,
    taskId: Schema.optional(Schema.NullOr(Schema.String)),
    taskRunId: Schema.optional(Schema.NullOr(Schema.String)),
    branch: Schema.optional(Schema.NullOr(Schema.String)),
    status: Schema.optional(Schema.String),
    createdAt: Schema.optional(Schema.String),
    builds: Schema.Array(BuildRecordSchema),
    deployments: Schema.Array(DeploymentRecordSchema),
    runEvents: Schema.Array(RunEventRecordSchema),
  }),
);

// importApp returns a project record.
export const ImportedProjectRecordSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  name: Schema.String,
  key: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  forgeGraphAppId: Schema.optional(Schema.NullOr(Schema.String)),
  repoUrl: Schema.optional(Schema.NullOr(Schema.String)),
});

// ---------------------------------------------------------------------------
// Webhook schemas (7B-4C Task 9)
// ---------------------------------------------------------------------------

export const WebhookConfigRecordSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  secret: Schema.String,
  events: Schema.Array(Schema.String),
  active: Schema.Boolean,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
});

export const WebhookDeliveryRecordSchema = Schema.Struct({
  id: Schema.String,
  configId: Schema.String,
  event: Schema.String,
  status: Schema.String,
  responseCode: Schema.optional(Schema.NullOr(Schema.Number)),
  responseBody: Schema.optional(Schema.NullOr(Schema.String)),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  deliveredAt: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
});

// ---------------------------------------------------------------------------
// PublicApi schemas (7B-4C Task 9)
// ---------------------------------------------------------------------------

export const RunStatusEnum = Schema.Literals(["running", "completed", "failed"]);

export const PublicApiArtifactTypeEnum = Schema.Literals([
  "diff",
  "log",
  "test-report",
  "file-snapshot",
]);

export const PublicApiRunRecordSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  workspaceId: Schema.String,
  agentType: Schema.String,
  status: Schema.String,
  summary: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  createdAt: Schema.optional(Schema.String),
});

export const PublicApiArtifactRecordSchema = Schema.Struct({
  id: Schema.String,
  runId: Schema.String,
  type: Schema.String,
  storageKey: Schema.String,
  metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  createdAt: Schema.optional(Schema.String),
});

export const HeartbeatRepoSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  isGit: Schema.Boolean,
  remoteUrl: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  dirty: Schema.optional(Schema.Boolean),
  buildSystem: Schema.optional(Schema.String),
  forgeAppId: Schema.optional(Schema.String),
});

export const WorkspaceRegistrationResultSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  machineId: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
});

export const ApiKeyResultSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  prefix: Schema.String,
});

// ---------------------------------------------------------------------------
// Workspace integration schemas
// ---------------------------------------------------------------------------

export const IntegrationRecordSchema = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  enabled: Schema.Boolean,
  hasApiKey: Schema.Boolean,
  hasWebhookSecret: Schema.Boolean,
  linearTeamId: Schema.NullOr(Schema.String),
  linearWebBaseUrl: Schema.NullOr(Schema.String),
  createdAt: Schema.optional(Schema.Unknown),
});

export const IntegrationMutationResultSchema = Schema.Struct({
  id: Schema.String,
  created: Schema.Boolean,
});

export const IntegrationSetupLinearResultSchema = Schema.Struct({
  id: Schema.String,
  created: Schema.Boolean,
  webhookId: Schema.String,
});

export const IntegrationDeleteResultSchema = Schema.Struct({
  deleted: Schema.Boolean,
});

export const LinearTeamSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  key: Schema.String,
});
