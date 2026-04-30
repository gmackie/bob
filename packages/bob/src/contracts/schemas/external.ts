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
