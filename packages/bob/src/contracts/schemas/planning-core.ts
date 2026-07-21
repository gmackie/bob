// Effect Schema definitions for Bob planning domain objects.
// Translated from Zod schemas in packages/bob/src/api/src/router/planning.ts.
// 7B-4C Task 4.
import { Schema } from "effect";

// --- Enums ---

export const PlanningStatusEnum = Schema.Literals([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]);

export const PlanningPriorityEnum = Schema.Literals([
  "no_priority",
  "urgent",
  "high",
  "medium",
  "low",
]);

export const PlanningKindEnum = Schema.Literals(["issue", "epic", "task"]);

export const CycleStatusEnum = Schema.Literals([
  "upcoming",
  "active",
  "completed",
]);

// --- Record schemas ---

export const PlanningWorkspaceRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
});

export const PlanningProjectSummarySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  key: Schema.String,
  status: Schema.String,
  color: Schema.String,
});

export const PlanningProjectListItemSchema = Schema.Struct({
  project: PlanningProjectSummarySchema,
  issueCount: Schema.Number,
  completedCount: Schema.Number,
});

export const PlanningProjectDetailSchema = Schema.Struct({
  project: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    key: Schema.String,
    description: Schema.optional(Schema.String),
    status: Schema.String,
    color: Schema.String,
  }),
  issueCount: Schema.Number,
  completedCount: Schema.Number,
  inProgressCount: Schema.Number,
  backlogCount: Schema.Number,
});

export const PlanningAssigneeSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export const PlanningLabelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.String,
});

export const PlanningLabelRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.String,
  description: Schema.optional(Schema.String),
});

export const PlanningTaskRecordSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  status: Schema.String,
  priority: Schema.String,
  kind: Schema.optional(Schema.String),
  project: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      key: Schema.optional(Schema.String),
    }),
  ),
  assignee: Schema.optional(PlanningAssigneeSchema),
  labels: Schema.optional(Schema.Array(PlanningLabelSchema)),
  dueDate: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
});

export const PlanningTaskByIdentifierResultSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  status: Schema.String,
  priority: Schema.String,
  projectId: Schema.String,
  dueDate: Schema.optional(Schema.String),
});

export const PlanningTaskMutationResultSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  status: Schema.String,
  priority: Schema.String,
});

export const PlanningCommentRecordSchema = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  user: Schema.optional(PlanningAssigneeSchema),
  createdAt: Schema.optional(Schema.String),
  replies: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        body: Schema.String,
        user: Schema.optional(PlanningAssigneeSchema),
        createdAt: Schema.optional(Schema.String),
      }),
    ),
  ),
});

export const PlanningCommentCreateResultSchema = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.optional(Schema.String),
});

export const PlanningLinearSyncResultSchema = Schema.Struct({
  projectsCreated: Schema.Number,
  projectsExisting: Schema.Number,
  issuesImported: Schema.Number,
  projectsTruncated: Schema.Boolean,
  issuesTruncated: Schema.Boolean,
});

export const PlanningSearchResultSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  status: Schema.String,
  priority: Schema.String,
  project: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
  ),
  assignee: Schema.optional(PlanningAssigneeSchema),
});

export const PlanningCycleRecordSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  number: Schema.Number,
  status: Schema.String,
  startDate: Schema.String,
  endDate: Schema.String,
  progress: Schema.Number,
  issueCount: Schema.Number,
  completedCount: Schema.Number,
});

export const PlanningUserRecordSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
});

export const AgentClaimResultSchema = Schema.Struct({
  id: Schema.String,
  issueId: Schema.String,
  status: Schema.String,
  claimedAt: Schema.String,
});

export const AgentProgressResultSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
});

export const AgentCompleteResultSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  completedAt: Schema.String,
});

export const AgentFailResultSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
});

export const AgentArtifactSchema = Schema.Struct({
  type: Schema.String,
  url: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
});

export const AgentAvailableTaskSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  priority: Schema.String,
  project: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      key: Schema.String,
    }),
  ),
  labels: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
      }),
    ),
  ),
});

export const AgentSessionResultSchema = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.String,
});

export const AgentEndSessionResultSchema = Schema.Struct({
  id: Schema.String,
  endedAt: Schema.String,
});
