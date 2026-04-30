// Effect Schema definitions for Bob planning session domain objects.
// Translated from Zod schemas in packages/bob/src/api/src/router/planSession.ts.
// 7B-4C Task 5.
import { Schema } from "effect";

// --- Enums ---

export const PlanningSessionTypeEnum = Schema.Literals([
  "office_hours",
  "ceo_review",
  "eng_review",
  "design_review",
  "breakdown",
  "shape",
]);

// --- Record schemas ---

/** Full planning session record returned from get/list queries. */
export const PlanSessionRecordSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  workingDirectory: Schema.optional(Schema.String),
  agentType: Schema.optional(Schema.String),
  sessionType: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  workItemId: Schema.optional(Schema.NullOr(Schema.String)),
  planningSessionType: Schema.optional(Schema.NullOr(Schema.String)),
  planningWorkspaceId: Schema.optional(Schema.NullOr(Schema.String)),
  planningProjectId: Schema.optional(Schema.NullOr(Schema.String)),
  planningProjectName: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

/** Plan draft record from the plan_drafts table. */
export const PlanDraftRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  workspaceId: Schema.optional(Schema.String),
  projectId: Schema.optional(Schema.String),
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.optional(Schema.String),
  priority: Schema.optional(Schema.String),
  sortOrder: Schema.optional(Schema.Number),
  status: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
});

/** Dependency record from the plan_draft_dependencies table. */
export const PlanDraftDependencySchema = Schema.Struct({
  id: Schema.String,
  draftId: Schema.String,
  dependsOnDraftId: Schema.String,
});

/** Result of saveArtifact mutation. */
export const PlanArtifactResultSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  artifactType: Schema.optional(Schema.String),
  artifactRole: Schema.optional(Schema.String),
  producerType: Schema.optional(Schema.String),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  isCurrent: Schema.optional(Schema.Boolean),
  createdAt: Schema.optional(Schema.String),
});

/** Single item in the getPriorContext result array. */
export const PriorContextItemSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(Schema.String),
  content: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

/** Result of getPriorContext query. */
export const PriorContextResultSchema = Schema.Array(PriorContextItemSchema);

/** Result of commitPlan mutation. */
export const CommitPlanResultSchema = Schema.Struct({
  committed: Schema.Number,
  tasks: Schema.Array(
    Schema.Struct({
      draftId: Schema.String,
      taskId: Schema.String,
      identifier: Schema.String,
    }),
  ),
});

/** Result of commitPlanLocal mutation. */
export const CommitPlanLocalResultSchema = Schema.Struct({
  committed: Schema.Number,
  workItems: Schema.Array(
    Schema.Struct({
      draftId: Schema.String,
      workItemId: Schema.String,
      title: Schema.String,
    }),
  ),
  dependencies: Schema.Number,
});

/** Launch context object for session.start. */
export const LaunchContextSchema = Schema.Struct({
  intent: Schema.Literals(["shape", "breakdown"]),
  notes: Schema.String,
  workItem: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      identifier: Schema.String,
      title: Schema.String,
      kind: Schema.String,
    }),
  ),
  selectedRepoSources: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      path: Schema.String,
      detail: Schema.String,
    }),
  ),
  attachedFiles: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      sizeLabel: Schema.String,
      content: Schema.optional(Schema.String),
    }),
  ),
});

/** Result of session.start mutation. */
export const SessionStartResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  sessionId: Schema.String,
});

/** Result of session.get query (session + drafts + dependencies). */
export const SessionGetResultSchema = Schema.NullOr(
  Schema.Struct({
    session: PlanSessionRecordSchema,
    drafts: Schema.Array(PlanDraftRecordSchema),
    dependencies: Schema.Array(PlanDraftDependencySchema),
  }),
);

/** Result of removeDraft / removeDependency. */
export const OkResultSchema = Schema.Struct({
  ok: Schema.Boolean,
});
