import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ============================================================================
// ENUMS
// ============================================================================

export const issueStatusEnum = pgEnum("issue_status", [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]);

export const issuePriorityEnum = pgEnum("issue_priority", [
  "no_priority",
  "urgent",
  "high",
  "medium",
  "low",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "backlog",
  "planned",
  "in_progress",
  "paused",
  "completed",
  "canceled",
]);

export const cycleStatusEnum = pgEnum("cycle_status", [
  "upcoming",
  "active",
  "completed",
]);

export const issueTypeEnum = pgEnum("issue_type", [
  "issue",
  "bug",
  "feature",
  "epic",
]);

export const issueFunnelSourceTypeEnum = pgEnum("issue_funnel_source_type", [
  "manual",
  "sentry",
  "ticket",
  "forgegraph",
  "api",
]);

export const issueFunnelArtifactTypeEnum = pgEnum("issue_funnel_artifact_type", [
  "idea",
  "plan",
  "brd",
  "spec",
  "task",
  "pr",
  "release",
]);

export const issueFunnelStageEnum = pgEnum("issue_funnel_stage", [
  "dumped",
  "triaged",
  "planned",
  "designed",
  "ready_for_execution",
  "picked_up",
  "staging_deployed",
  "staging_verified",
  "production_deployed",
]);

export const issueFunnelTshirtSizeEnum = pgEnum("issue_funnel_tshirt_size", [
  "xs",
  "s",
  "m",
  "l",
  "xl",
  "xxl",
]);

export const webhookEventEnum = pgEnum("webhook_event", [
  "push",
  "pull_request",
  "pull_request_review",
  "deployment",
  "deployment_status",
  "issue_comment",
  "issues",
]);

export const outboundWebhookEventEnum = pgEnum("outbound_webhook_event", [
  "issue.created",
  "issue.updated",
  "issue.deleted",
  "issue.status_changed",
  "issue.completed",
  "issue.funnel_stage_changed",
  "comment.created",
]);

export const integrationTypeEnum = pgEnum("integration_type", [
  "github",
  "gitea",
  "gitlab",
  "slack",
  "discord",
  "bob",
]);

export const executionBackendEnum = pgEnum("execution_backend", [
  "bob",
]);

export const bobLaunchPolicyEnum = pgEnum("bob_launch_policy", [
  "auto_or_manual",
  "manual_only",
]);

export const activityTypeEnum = pgEnum("activity_type", [
  "created",
  "updated",
  "status_changed",
  "priority_changed",
  "assignee_changed",
  "label_added",
  "label_removed",
  "comment_added",
  "attachment_added",
  "linked_to_pr",
  "linked_to_commit",
  "cycle_changed",
  "project_changed",
  "estimate_changed",
  "due_date_changed",
  "parent_changed",
  "agent_claimed",
  "agent_started",
  "agent_progress",
  "agent_completed",
  "agent_failed",
  "agent_handed_off",
  "funnel_stage_changed",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "issue_assigned",
  "issue_mentioned",
  "issue_commented",
  "issue_status_changed",
  "project_update",
  "cycle_started",
  "cycle_ended",
  "agent_started_task",
  "agent_completed_task",
  "agent_failed_task",
  "agent_needs_input",
  "agent_created_task",
]);

export const agentSessionStatusEnum = pgEnum("agent_session_status", [
  "idle",
  "working",
  "paused",
]);

export const agentTaskRunStatusEnum = pgEnum("agent_task_run_status", [
  "claimed",
  "in_progress",
  "completed",
  "failed",
  "failed_to_start",
  "abandoned",
  "handed_off",
  "superseded",
]);

export const issueArtifactTypeEnum = pgEnum("issue_artifact_type", [
  "pr",
  "verification",
  "build",
  "test_report",
  "doc",
  "deliverable",
  "other",
]);

export const issueArtifactProducerTypeEnum = pgEnum(
  "issue_artifact_producer_type",
  [
    "bob",
    "forgegraph",
    "human",
    "system",
  ]
);

export const forgeStorageBackendEnum = pgEnum("forge_storage_backend", [
  "s3",
  "rsync",
]);

export const forgeRunOverlayStatusEnum = pgEnum("forge_run_overlay_status", [
  "created",
  "patch_applied",
  "tests_started",
  "tests_finished",
  "approved",
  "integrated",
  "failed",
]);

export const forgeBuildStatusEnum = pgEnum("forge_build_status", [
  "queued",
  "running",
  "passed",
  "failed",
  "canceled",
  "superseded",
]);

export const forgeDeploymentStatusEnum = pgEnum("forge_deployment_status", [
  "pending_approval",
  "queued",
  "building",
  "testing",
  "verifying",
  "deploying",
  "healthy",
  "unhealthy",
  "rolled_back",
  "failed",
]);

export const forgeEnvironmentEnum = pgEnum("forge_environment", [
  "dev",
  "staging",
  "prod",
  "preview",
]);

// ============================================================================
// CORE TABLES
// ============================================================================

// Users - supports Entra ID SSO, GitHub OAuth, Gitea OAuth, and API keys
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    // OAuth provider IDs
    entraId: text("entra_id").unique(), // Microsoft Entra ID (Azure AD) - primary auth for @gmacko.com
    githubId: text("github_id").unique(), // GitHub OAuth
    giteaId: text("gitea_id").unique(), // Gitea OAuth
    githubUsername: text("github_username"),
    giteaUsername: text("gitea_username"),
    // OAuth tokens (encrypted in production)
    githubAccessToken: text("github_access_token"),
    giteaAccessToken: text("gitea_access_token"),
    // Settings
    timezone: text("timezone").default("UTC"),
    isAdmin: boolean("is_admin").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    // Agent fields
    isAgent: boolean("is_agent").notNull().default(false),
    agentConfig: jsonb("agent_config").$type<{
      capabilities: string[];
      allowedProjects: string[];
      allowedLabels: string[];
      excludedLabels: string[];
      maxConcurrentTasks: number;
      autoClaimEnabled: boolean;
      autoClaimCriteria?: {
        priorities: string[];
        statuses: string[];
        maxEstimate?: number;
      };
      avatar?: {
        primaryColor: string;
        accentColor: string;
        variant: "default" | "friendly" | "technical" | "creative";
      };
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("users_email_idx").on(table.email),
    index("users_entra_id_idx").on(table.entraId),
    index("users_github_id_idx").on(table.githubId),
    index("users_gitea_id_idx").on(table.giteaId),
    index("users_is_agent_idx").on(table.isAgent),
  ]
);

// API Keys for MCP/LLM agent access
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // Friendly name like "Claude MCP Server"
    keyHash: text("key_hash").notNull(), // SHA-256 hash of the API key
    keyPrefix: varchar("key_prefix", { length: 8 }).notNull(), // First 8 chars for identification (lc_xxxx)
    scopes: jsonb("scopes").notNull().default(["read"]), // ["read", "write", "admin"]
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("api_keys_user_idx").on(table.userId),
    index("api_keys_key_hash_idx").on(table.keyHash),
    index("api_keys_prefix_idx").on(table.keyPrefix),
  ]
);

// Sessions for web auth
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionToken: text("session_token").notNull().unique(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_token_idx").on(table.sessionToken),
  ]
);

// Agent Sessions (tracks active agent work sessions)
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    executionBackend: executionBackendEnum("execution_backend")
      .notNull()
      .default("bob"),
    status: agentSessionStatusEnum("status").notNull().default("idle"),
    currentIssueId: uuid("current_issue_id"),
    externalSessionId: text("external_session_id"),
    externalSessionUrl: text("external_session_url"),
    workflowStatus: text("workflow_status"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<{
      clientInfo?: string;
      version?: string;
      capabilities?: string[];
    }>(),
  },
  (table) => [
    index("agent_sessions_agent_idx").on(table.agentId),
    index("agent_sessions_workspace_idx").on(table.workspaceId),
    index("agent_sessions_status_idx").on(table.status),
    index("agent_sessions_heartbeat_idx").on(table.lastHeartbeatAt),
  ]
);

// Agent Task Runs (tracks agent task execution history)
export const agentTaskRuns = pgTable(
  "agent_task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => agentSessions.id, {
      onDelete: "set null",
    }),
    status: agentTaskRunStatusEnum("status").notNull().default("claimed"),
    executionBackend: executionBackendEnum("execution_backend")
      .notNull()
      .default("bob"),
    externalSessionId: text("external_session_id"),
    externalSessionUrl: text("external_session_url"),
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    result: jsonb("result").$type<{
      success: boolean;
      summary?: string;
      artifacts?: Array<{
        type: "pr" | "commit" | "file" | "comment";
        url?: string;
        description?: string;
      }>;
      error?: {
        code: string;
        message: string;
        recoverable: boolean;
      };
    }>(),
    progressLog: text("progress_log"), // Append-only log of progress updates
    latestSummary: text("latest_summary"),
    lastPromptCommentId: uuid("last_prompt_comment_id"),
    reviewUrl: text("review_url"),
    artifactRefs: jsonb("artifact_refs").$type<
      Array<{
        type: string;
        url: string;
        title?: string;
        summary?: string;
      }>
    >(),
    completionSource: text("completion_source"),
    handedOffTo: uuid("handed_off_to").references(() => users.id),
    handoffReason: text("handoff_reason"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededReason: text("superseded_reason"),
  },
  (table) => [
    index("agent_task_runs_agent_idx").on(table.agentId),
    index("agent_task_runs_issue_idx").on(table.issueId),
    index("agent_task_runs_session_idx").on(table.sessionId),
    index("agent_task_runs_status_idx").on(table.status),
    index("agent_task_runs_claimed_idx").on(table.claimedAt),
  ]
);

export const issueArtifacts = pgTable(
  "issue_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    agentTaskRunId: uuid("agent_task_run_id").references(() => agentTaskRuns.id, {
      onDelete: "set null",
    }),
    executionBackend: executionBackendEnum("execution_backend")
      .notNull()
      .default("bob"),
    producerType: issueArtifactProducerTypeEnum("producer_type").notNull(),
    producerId: text("producer_id"),
    artifactType: issueArtifactTypeEnum("artifact_type").notNull(),
    artifactRole: text("artifact_role").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    summary: text("summary"),
    metadata: jsonb("metadata"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("issue_artifacts_issue_idx").on(table.issueId),
    index("issue_artifacts_run_idx").on(table.agentTaskRunId),
    index("issue_artifacts_current_idx").on(table.issueId, table.isCurrent),
    index("issue_artifacts_type_idx").on(table.artifactType),
    index("issue_artifacts_role_idx").on(table.artifactRole),
  ]
);

export const forgeRepositories = pgTable(
  "forge_repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    defaultBaseBookmark: text("default_base_bookmark").notNull().default("base"),
    defaultIntegrationBookmark: text("default_integration_bookmark")
      .notNull()
      .default("integration"),
    storageBackend: forgeStorageBackendEnum("storage_backend")
      .notNull()
      .default("s3"),
    storagePrefix: text("storage_prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("forge_repositories_workspace_idx").on(table.workspaceId),
    index("forge_repositories_name_idx").on(table.name),
  ]
);

export const forgeRevisions = pgTable(
  "forge_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => forgeRepositories.id, { onDelete: "cascade" }),
    revId: text("rev_id").notNull(),
    changeId: text("change_id"),
    parentRevIds: jsonb("parent_rev_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    author: text("author"),
    description: text("description"),
    createdAtJj: timestamp("created_at_jj", { withTimezone: true }),
    bookmarks: jsonb("bookmarks")
      .$type<string[]>()
      .notNull()
      .default([]),
    metadata: jsonb("metadata").$type<{
      taskId?: string;
      runId?: string;
      agentId?: string;
      baseRev?: string;
      [key: string]: unknown;
    }>(),
    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("forge_revisions_repo_idx").on(table.repoId),
    index("forge_revisions_rev_idx").on(table.revId),
    index("forge_revisions_change_idx").on(table.changeId),
  ]
);

export const forgeStacks = pgTable(
  "forge_stacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => forgeRepositories.id, { onDelete: "cascade" }),
    baseRevId: text("base_rev_id").notNull(),
    tipRevId: text("tip_rev_id").notNull(),
    revIds: jsonb("rev_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("forge_stacks_repo_idx").on(table.repoId),
    index("forge_stacks_base_idx").on(table.baseRevId),
    index("forge_stacks_tip_idx").on(table.tipRevId),
  ]
);

export const forgeRunOverlays = pgTable(
  "forge_run_overlays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id").notNull(),
    taskId: uuid("task_id").references(() => issues.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "set null" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => forgeRepositories.id, { onDelete: "cascade" }),
    revId: text("rev_id").notNull(),
    status: forgeRunOverlayStatusEnum("status").notNull().default("created"),
    testStatus: text("test_status"),
    artifactRefs: jsonb("artifact_refs").$type<
      Array<{
        type: "log" | "junit" | "coverage" | "build" | "other";
        url?: string;
        description?: string;
      }>
    >(),
    timestamps: jsonb("timestamps").$type<{
      createdAt?: string;
      updatedAt?: string;
      testsStartedAt?: string;
      testsFinishedAt?: string;
      approvedAt?: string;
      integratedAt?: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("forge_run_overlays_run_idx").on(table.runId),
    index("forge_run_overlays_task_idx").on(table.taskId),
    index("forge_run_overlays_agent_idx").on(table.agentId),
    index("forge_run_overlays_repo_idx").on(table.repoId),
    index("forge_run_overlays_rev_idx").on(table.revId),
    index("forge_run_overlays_status_idx").on(table.status),
  ]
);

export const forgeBuilds = pgTable(
  "forge_builds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: text("repo_id").notNull(),
    revId: text("rev_id").notNull(),
    runId: text("run_id"),
    taskId: uuid("task_id").references(() => issues.id, { onDelete: "set null" }),
    status: forgeBuildStatusEnum("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    ciProvider: text("ci_provider").default("github_actions"),
    externalJobId: text("external_job_id"),
    artifactManifestRef: text("artifact_manifest_ref"),
    imageDigest: text("image_digest"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    supersededByBuildId: uuid("superseded_by_build_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("forge_builds_repo_idx").on(table.repoId),
    index("forge_builds_rev_idx").on(table.revId),
    index("forge_builds_run_idx").on(table.runId),
    index("forge_builds_task_idx").on(table.taskId),
    index("forge_builds_status_idx").on(table.status),
    index("forge_builds_idempotency_idx").on(table.idempotencyKey),
    index("forge_builds_superseded_idx").on(table.supersededByBuildId),
  ]
);

export const forgeBuildArtifacts = pgTable(
  "forge_build_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buildId: uuid("build_id")
      .notNull()
      .references(() => forgeBuilds.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    digest: text("digest"),
    storageKey: text("storage_key").notNull(),
    sizeBytes: integer("size_bytes"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("forge_build_artifacts_build_idx").on(table.buildId),
    index("forge_build_artifacts_type_idx").on(table.type),
    index("forge_build_artifacts_digest_idx").on(table.digest),
  ]
);

export const forgeDeployments = pgTable(
  "forge_deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: text("repo_id").notNull(),
    revId: text("rev_id").notNull(),
    buildId: uuid("build_id")
      .notNull()
      .references(() => forgeBuilds.id, { onDelete: "cascade" }),
    environment: forgeEnvironmentEnum("environment").notNull(),
    status: forgeDeploymentStatusEnum("status")
      .notNull()
      .default("pending_approval"),
    rollbackTargetDeploymentId: uuid("rollback_target_deployment_id"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("forge_deployments_repo_idx").on(table.repoId),
    index("forge_deployments_rev_idx").on(table.revId),
    index("forge_deployments_build_idx").on(table.buildId),
    index("forge_deployments_env_idx").on(table.environment),
    index("forge_deployments_status_idx").on(table.status),
    index("forge_deployments_rollback_idx").on(table.rollbackTargetDeploymentId),
  ]
);

export const forgePreviews = pgTable(
  "forge_previews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: text("repo_id").notNull(),
    revId: text("rev_id").notNull(),
    url: text("url").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("forge_previews_repo_idx").on(table.repoId),
    index("forge_previews_rev_idx").on(table.revId),
    index("forge_previews_status_idx").on(table.status),
    index("forge_previews_expires_idx").on(table.expiresAt),
  ]
);

export const forgeBuildEvents = pgTable(
  "forge_build_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buildId: uuid("build_id")
      .notNull()
      .references(() => forgeBuilds.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("forge_build_events_build_idx").on(table.buildId),
    index("forge_build_events_type_idx").on(table.eventType),
    index("forge_build_events_occurred_idx").on(table.occurredAt),
  ]
);

// Workspaces (Organizations)
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    logoUrl: text("logo_url"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("workspaces_slug_idx").on(table.slug),
    index("workspaces_owner_idx").on(table.ownerId),
  ]
);

// Workspace Members
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 50 }).notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("workspace_members_workspace_idx").on(table.workspaceId),
    index("workspace_members_user_idx").on(table.userId),
  ]
);

// Teams
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    key: varchar("key", { length: 10 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 7 }).default("#6366f1"),
    icon: text("icon"),
    timezone: text("timezone").default("UTC"),
    defaultAssigneeId: uuid("default_assignee_id").references(() => users.id),
    issueCount: integer("issue_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("teams_workspace_idx").on(table.workspaceId),
    index("teams_key_idx").on(table.key),
  ]
);

// Team Members
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 50 }).notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("team_members_team_idx").on(table.teamId),
    index("team_members_user_idx").on(table.userId),
  ]
);

// Project Groups (for organizing projects in the sidebar/projects page)
export const projectGroups = pgTable(
  "project_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: varchar("color", { length: 7 }).default("#6366f1"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("project_groups_workspace_idx").on(table.workspaceId),
    index("project_groups_sort_idx").on(table.sortOrder),
  ]
);

// Projects (= Git repositories, owns issues)
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => projectGroups.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    key: varchar("key", { length: 10 }).notNull(),
    description: text("description"),
    icon: text("icon"),
    color: varchar("color", { length: 7 }).default("#6366f1"),
    status: projectStatusEnum("status").notNull().default("backlog"),
    leadId: uuid("lead_id").references(() => users.id),
    startDate: timestamp("start_date", { withTimezone: true }),
    targetDate: timestamp("target_date", { withTimezone: true }),
    progress: integer("progress").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    issueCount: integer("issue_count").notNull().default(0), // For generating issue numbers
    // Git repository link
    repositoryProvider: varchar("repository_provider", { length: 20 }), // 'github', 'gitea', 'gitlab'
    repositoryFullName: text("repository_full_name"), // e.g., "org/repo-name"
    repositoryUrl: text("repository_url"),
    repositoryExternalId: text("repository_external_id"), // External ID for webhook matching
    webhookSecret: text("webhook_secret"), // For signature verification
    forgeRepositoryId: uuid("forge_repository_id").references(
      () => forgeRepositories.id,
      { onDelete: "set null" }
    ),
    // Issue sync settings - when enabled, tasks created in this project sync to external repo issues
    issueSyncEnabled: boolean("issue_sync_enabled").notNull().default(false),
    issueSyncDirection: varchar("issue_sync_direction", { length: 20 }).default("bidirectional"), // 'outbound_only', 'inbound_only', 'bidirectional'
    bobLaunchPolicy: bobLaunchPolicyEnum("bob_launch_policy"),
    bobAwaitingInputTimeoutMinutes: integer("bob_awaiting_input_timeout_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("projects_workspace_idx").on(table.workspaceId),
    index("projects_group_idx").on(table.groupId),
    index("projects_status_idx").on(table.status),
    index("projects_lead_idx").on(table.leadId),
    index("projects_key_idx").on(table.key),
    index("projects_repo_idx").on(table.repositoryExternalId),
    index("projects_forge_repo_idx").on(table.forgeRepositoryId),
  ]
);

// Project Repositories (many-to-many: projects can have multiple repos from different providers)
export const projectRepositories = pgTable(
  "project_repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 20 }).notNull(),
    externalId: text("external_id").notNull(),
    fullName: text("full_name").notNull(),
    url: text("url"),
    defaultBranch: text("default_branch").default("main"),
    webhookConfigured: boolean("webhook_configured").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_repos_project_idx").on(table.projectId),
    index("project_repos_provider_idx").on(table.provider),
    index("project_repos_external_idx").on(table.externalId),
    index("project_repos_full_name_idx").on(table.fullName),
  ]
);

// Project Teams (many-to-many)
export const projectTeams = pgTable(
  "project_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("project_teams_project_idx").on(table.projectId),
    index("project_teams_team_idx").on(table.teamId),
  ]
);

// Project Documents (planning files, roadmaps, specs - markdown content for AI/LLM use)
export const projectDocuments = pgTable(
  "project_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    type: varchar("type", { length: 50 }).notNull().default("planning"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id),
    updatedById: uuid("updated_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("project_documents_project_idx").on(table.projectId),
    index("project_documents_type_idx").on(table.type),
    index("project_documents_created_by_idx").on(table.createdById),
  ]
);

// Cycles (Sprints)
export const cycles = pgTable(
  "cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name"),
    description: text("description"),
    number: integer("number").notNull(),
    status: cycleStatusEnum("status").notNull().default("upcoming"),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    progress: integer("progress").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("cycles_team_idx").on(table.teamId),
    index("cycles_status_idx").on(table.status),
    index("cycles_dates_idx").on(table.startDate, table.endDate),
  ]
);

// Labels
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#6366f1"),
    description: text("description"),
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("labels_workspace_idx").on(table.workspaceId),
    index("labels_team_idx").on(table.teamId),
  ]
);

// Issues (Tasks) - owned by Projects
export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    cycleId: uuid("cycle_id").references(() => cycles.id, {
      onDelete: "set null",
    }),
    parentId: uuid("parent_id"),
    epicId: uuid("epic_id"),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    assigneeId: uuid("assignee_id").references(() => users.id),
    number: integer("number").notNull(),
    identifier: varchar("identifier", { length: 20 }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    descriptionHtml: text("description_html"),
    type: issueTypeEnum("type").notNull().default("issue"),
    status: issueStatusEnum("status").notNull().default("backlog"),
    priority: issuePriorityEnum("priority").notNull().default("no_priority"),
    estimate: integer("estimate"),
    storyPoints: integer("story_points"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    subIssuesSortOrder: integer("sub_issues_sort_order").notNull().default(0),
    kanbanRank: text("kanban_rank"), // LexoRank-style ordering for kanban board
    trashed: boolean("trashed").notNull().default(false),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    externalIssueProvider: varchar("external_issue_provider", { length: 20 }),
    externalIssueId: text("external_issue_id"),
    externalIssueNumber: integer("external_issue_number"),
    externalIssueUrl: text("external_issue_url"),
    externalIssueSyncedAt: timestamp("external_issue_synced_at", { withTimezone: true }),
    funnelSourceType: issueFunnelSourceTypeEnum("funnel_source_type")
      .notNull()
      .default("manual"),
    funnelSourceId: text("funnel_source_id"),
  funnelSourceUrl: text("funnel_source_url"),
  funnelTshirtSize: issueFunnelTshirtSizeEnum("funnel_tshirt_size"),
  funnelArtifactType: issueFunnelArtifactTypeEnum("funnel_artifact_type")
    .notNull()
    .default("idea"),
  funnelStage: issueFunnelStageEnum("funnel_stage").notNull().default("dumped"),
  funnelMetadata: jsonb("funnel_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("issues_project_idx").on(table.projectId),
    index("issues_team_idx").on(table.teamId),
    index("issues_cycle_idx").on(table.cycleId),
    index("issues_assignee_idx").on(table.assigneeId),
    index("issues_creator_idx").on(table.creatorId),
    index("issues_status_idx").on(table.status),
    index("issues_priority_idx").on(table.priority),
    index("issues_type_idx").on(table.type),
  index("issues_funnel_source_type_idx").on(table.funnelSourceType),
  index("issues_funnel_artifact_type_idx").on(table.funnelArtifactType),
  index("issues_funnel_stage_idx").on(table.funnelStage),
  index("issues_funnel_tshirt_size_idx").on(table.funnelTshirtSize),
  index("issues_identifier_idx").on(table.identifier),
  index("issues_parent_idx").on(table.parentId),
    index("issues_epic_idx").on(table.epicId),
    index("issues_due_date_idx").on(table.dueDate),
    index("issues_kanban_rank_idx").on(table.status, table.kanbanRank),
    index("issues_external_issue_idx").on(table.externalIssueProvider, table.externalIssueId),
  ]
);

// Issue Labels (many-to-many)
export const issueLabels = pgTable(
  "issue_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("issue_labels_issue_idx").on(table.issueId),
    index("issue_labels_label_idx").on(table.labelId),
  ]
);

// Issue Subscribers
export const issueSubscribers = pgTable(
  "issue_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("issue_subscribers_issue_idx").on(table.issueId),
    index("issue_subscribers_user_idx").on(table.userId),
  ]
);

// Comments
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    bodyHtml: text("body_html"),
    edited: boolean("edited").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("comments_issue_idx").on(table.issueId),
    index("comments_user_idx").on(table.userId),
    index("comments_parent_idx").on(table.parentId),
  ]
);

// Comment Reactions
export const commentReactions = pgTable(
  "comment_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: varchar("emoji", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("comment_reactions_comment_idx").on(table.commentId),
    index("comment_reactions_user_idx").on(table.userId),
  ]
);

// Attachments
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    filename: text("filename").notNull(),
    url: text("url").notNull(),
    size: integer("size").notNull(),
    mimeType: varchar("mime_type", { length: 100 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("attachments_issue_idx").on(table.issueId),
    index("attachments_creator_idx").on(table.creatorId),
  ]
);

// Activity Log
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    type: activityTypeEnum("type").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    changes: jsonb("changes"), // Structured change details
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("activities_issue_idx").on(table.issueId),
    index("activities_user_idx").on(table.userId),
    index("activities_type_idx").on(table.type),
    index("activities_created_idx").on(table.createdAt),
  ]
);

// ============================================================================
// INTEGRATIONS & WEBHOOKS
// ============================================================================

// Integrations (GitHub, Gitea, etc.)
export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: integrationTypeEnum("type").notNull(),
    name: text("name").notNull(),
    settings: jsonb("settings"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("integrations_workspace_idx").on(table.workspaceId),
    index("integrations_type_idx").on(table.type),
  ]
);

// Integration Repositories
export const integrationRepos = pgTable(
  "integration_repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    url: text("url"),
    defaultBranch: text("default_branch").default("main"),
    autoLinkEnabled: boolean("auto_link_enabled").notNull().default(true),
    autoCloseEnabled: boolean("auto_close_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("integration_repos_integration_idx").on(table.integrationId),
    index("integration_repos_project_idx").on(table.projectId),
    index("integration_repos_team_idx").on(table.teamId),
    index("integration_repos_external_idx").on(table.externalId),
  ]
);

// Webhooks Configuration
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id").references(() => integrations.id, {
      onDelete: "set null",
    }),
    provider: varchar("provider", { length: 20 }).notNull().default("github"), // 'github', 'gitea', 'gitlab'
    repositoryUrl: text("repository_url"), // URL or full_name of the repository to match
    url: text("url").notNull(),
    secret: text("secret"),
    events: jsonb("events").notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("webhooks_workspace_idx").on(table.workspaceId),
    index("webhooks_integration_idx").on(table.integrationId),
    index("webhooks_provider_idx").on(table.provider),
  ]
);

// Webhook Deliveries (for debugging/logging)
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id").references(() => webhooks.id, {
      onDelete: "cascade",
    }),
    event: text("event").notNull(), // Event type as string for flexibility
    payload: jsonb("payload").notNull(),
    response: jsonb("response"),
    responseBody: text("response_body"), // Response message for logging
    statusCode: integer("status_code"),
    success: boolean("success").notNull().default(false),
    error: text("error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("webhook_deliveries_webhook_idx").on(table.webhookId),
    index("webhook_deliveries_event_idx").on(table.event),
    index("webhook_deliveries_delivered_idx").on(table.deliveredAt),
  ]
);

// Outbound Webhooks (customer-configured webhooks for external integrations)
export const outboundWebhooks = pgTable(
  "outbound_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret"),
    events: jsonb("events").notNull().default([]),
    projectIds: jsonb("project_ids").default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("outbound_webhooks_workspace_idx").on(table.workspaceId),
    index("outbound_webhooks_enabled_idx").on(table.enabled),
  ]
);

// Outbound Webhook Deliveries (for debugging/logging)
export const outboundWebhookDeliveries = pgTable(
  "outbound_webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => outboundWebhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    statusCode: integer("status_code"),
    responseBody: text("response_body"),
    success: boolean("success").notNull().default(false),
    error: text("error"),
    durationMs: integer("duration_ms"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("outbound_webhook_deliveries_webhook_idx").on(table.webhookId),
    index("outbound_webhook_deliveries_event_idx").on(table.event),
    index("outbound_webhook_deliveries_delivered_idx").on(table.deliveredAt),
  ]
);

// Issue Git Links (connects issues to PRs/commits)
export const issueGitLinks = pgTable(
  "issue_git_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    integrationRepoId: uuid("integration_repo_id").references(
      () => integrationRepos.id,
      { onDelete: "cascade" }
    ),
    provider: varchar("provider", { length: 20 }).notNull().default("github"), // 'github', 'gitea', 'gitlab'
    type: varchar("type", { length: 20 }).notNull(), // 'pull_request', 'commit', 'branch'
    externalId: text("external_id"),
    number: integer("number"),
    title: text("title"),
    url: text("url").notNull(),
    state: varchar("state", { length: 20 }), // 'open', 'closed', 'merged', 'committed'
    author: text("author"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("issue_git_links_issue_idx").on(table.issueId),
    index("issue_git_links_repo_idx").on(table.integrationRepoId),
    index("issue_git_links_url_idx").on(table.url),
    index("issue_git_links_type_idx").on(table.type),
  ]
);

// Issue Dependencies (blocking relationships)
export const issueDependencies = pgTable(
  "issue_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockingIssueId: uuid("blocking_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    blockedIssueId: uuid("blocked_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("issue_deps_blocking_idx").on(table.blockingIssueId),
    index("issue_deps_blocked_idx").on(table.blockedIssueId),
  ]
);

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    issueId: uuid("issue_id").references(() => issues.id, {
      onDelete: "cascade",
    }),
    actorId: uuid("actor_id").references(() => users.id),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    read: boolean("read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("notifications_user_idx").on(table.userId),
    index("notifications_issue_idx").on(table.issueId),
    index("notifications_read_idx").on(table.read),
    index("notifications_created_idx").on(table.createdAt),
  ]
);

// ============================================================================
// VIEWS & FILTERS (saved searches)
// ============================================================================

export const customViews = pgTable(
  "custom_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    color: varchar("color", { length: 7 }),
    filters: jsonb("filters").notNull().default({}),
    sortBy: text("sort_by"),
    sortDirection: varchar("sort_direction", { length: 4 }).default("asc"),
    displayProperties: jsonb("display_properties"),
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("custom_views_workspace_idx").on(table.workspaceId),
    index("custom_views_team_idx").on(table.teamId),
    index("custom_views_creator_idx").on(table.creatorId),
  ]
);

// ============================================================================
// USER SETTINGS
// ============================================================================

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    dashboardWidgets: jsonb("dashboard_widgets"),
    dashboardLayout: jsonb("dashboard_layout"),
    defaultFilters: jsonb("default_filters"),
    kanbanSettings: jsonb("kanban_settings"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("user_settings_user_idx").on(table.userId)]
);

// ============================================================================
// FAVORITES
// ============================================================================

export const favorites = pgTable(
  "favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issues.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    customViewId: uuid("custom_view_id").references(() => customViews.id, {
      onDelete: "cascade",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("favorites_user_idx").on(table.userId),
    index("favorites_issue_idx").on(table.issueId),
    index("favorites_project_idx").on(table.projectId),
  ]
);

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  workspaceMemberships: many(workspaceMembers),
  teamMemberships: many(teamMembers),
  ownedWorkspaces: many(workspaces),
  createdIssues: many(issues, { relationName: "creator" }),
  assignedIssues: many(issues, { relationName: "assignee" }),
  comments: many(comments),
  activities: many(activities),
  notifications: many(notifications),
  favorites: many(favorites),
  apiKeys: many(apiKeys),
  sessions: many(sessions),
  settings: one(userSettings),
  agentSessions: many(agentSessions),
  agentTaskRuns: many(agentTaskRuns),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, {
    fields: [userSettings.userId],
    references: [users.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const agentSessionsRelations = relations(agentSessions, ({ one, many }) => ({
  agent: one(users, {
    fields: [agentSessions.agentId],
    references: [users.id],
  }),
  currentIssue: one(issues, {
    fields: [agentSessions.currentIssueId],
    references: [issues.id],
  }),
  taskRuns: many(agentTaskRuns),
}));

export const agentTaskRunsRelations = relations(agentTaskRuns, ({ one }) => ({
  agent: one(users, {
    fields: [agentTaskRuns.agentId],
    references: [users.id],
  }),
  issue: one(issues, {
    fields: [agentTaskRuns.issueId],
    references: [issues.id],
  }),
  session: one(agentSessions, {
    fields: [agentTaskRuns.sessionId],
    references: [agentSessions.id],
  }),
  handedOffToUser: one(users, {
    fields: [agentTaskRuns.handedOffTo],
    references: [users.id],
    relationName: "handedOffTo",
  }),
}));

export const issueArtifactsRelations = relations(issueArtifacts, ({ one }) => ({
  issue: one(issues, {
    fields: [issueArtifacts.issueId],
    references: [issues.id],
  }),
  agentTaskRun: one(agentTaskRuns, {
    fields: [issueArtifacts.agentTaskRunId],
    references: [agentTaskRuns.id],
  }),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, {
    fields: [workspaces.ownerId],
    references: [users.id],
  }),
  members: many(workspaceMembers),
  teams: many(teams),
  projects: many(projects),
  projectGroups: many(projectGroups),
  labels: many(labels),
  integrations: many(integrations),
  webhooks: many(webhooks),
  customViews: many(customViews),
}));

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
    }),
    user: one(users, {
      fields: [workspaceMembers.userId],
      references: [users.id],
    }),
  })
);

export const teamsRelations = relations(teams, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [teams.workspaceId],
    references: [workspaces.id],
  }),
  defaultAssignee: one(users, {
    fields: [teams.defaultAssigneeId],
    references: [users.id],
  }),
  members: many(teamMembers),
  issues: many(issues),
  cycles: many(cycles),
  labels: many(labels),
  projectTeams: many(projectTeams),
  integrationRepos: many(integrationRepos),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
}));

export const projectGroupsRelations = relations(projectGroups, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [projectGroups.workspaceId],
    references: [workspaces.id],
  }),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  group: one(projectGroups, {
    fields: [projects.groupId],
    references: [projectGroups.id],
  }),
  lead: one(users, {
    fields: [projects.leadId],
    references: [users.id],
  }),
  issues: many(issues),
  projectTeams: many(projectTeams),
  favorites: many(favorites),
  integrationRepos: many(integrationRepos),
  repositories: many(projectRepositories),
  forgeRepository: one(forgeRepositories, {
    fields: [projects.forgeRepositoryId],
    references: [forgeRepositories.id],
    relationName: "projectForgeRepository",
  }),
  documents: many(projectDocuments),
}));

export const projectDocumentsRelations = relations(projectDocuments, ({ one }) => ({
  project: one(projects, {
    fields: [projectDocuments.projectId],
    references: [projects.id],
  }),
  createdBy: one(users, {
    fields: [projectDocuments.createdById],
    references: [users.id],
    relationName: "documentCreator",
  }),
  updatedBy: one(users, {
    fields: [projectDocuments.updatedById],
    references: [users.id],
    relationName: "documentUpdater",
  }),
}));

export const projectRepositoriesRelations = relations(projectRepositories, ({ one }) => ({
  project: one(projects, {
    fields: [projectRepositories.projectId],
    references: [projects.id],
  }),
}));

export const projectTeamsRelations = relations(projectTeams, ({ one }) => ({
  project: one(projects, {
    fields: [projectTeams.projectId],
    references: [projects.id],
  }),
  team: one(teams, {
    fields: [projectTeams.teamId],
    references: [teams.id],
  }),
}));

export const cyclesRelations = relations(cycles, ({ one, many }) => ({
  team: one(teams, {
    fields: [cycles.teamId],
    references: [teams.id],
  }),
  issues: many(issues),
}));

export const labelsRelations = relations(labels, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [labels.workspaceId],
    references: [workspaces.id],
  }),
  team: one(teams, {
    fields: [labels.teamId],
    references: [teams.id],
  }),
  parent: one(labels, {
    fields: [labels.parentId],
    references: [labels.id],
  }),
  issueLabels: many(issueLabels),
}));

export const issuesRelations = relations(issues, ({ one, many }) => ({
  project: one(projects, {
    fields: [issues.projectId],
    references: [projects.id],
  }),
  team: one(teams, {
    fields: [issues.teamId],
    references: [teams.id],
  }),
  cycle: one(cycles, {
    fields: [issues.cycleId],
    references: [cycles.id],
  }),
  parent: one(issues, {
    fields: [issues.parentId],
    references: [issues.id],
    relationName: "subIssues",
  }),
  subIssues: many(issues, { relationName: "subIssues" }),
  epic: one(issues, {
    fields: [issues.epicId],
    references: [issues.id],
    relationName: "epicIssues",
  }),
  epicIssues: many(issues, { relationName: "epicIssues" }),
  creator: one(users, {
    fields: [issues.creatorId],
    references: [users.id],
    relationName: "creator",
  }),
  assignee: one(users, {
    fields: [issues.assigneeId],
    references: [users.id],
    relationName: "assignee",
  }),
  issueLabels: many(issueLabels),
  comments: many(comments),
  attachments: many(attachments),
  activities: many(activities),
  artifacts: many(issueArtifacts),
  subscribers: many(issueSubscribers),
  gitLinks: many(issueGitLinks),
  notifications: many(notifications),
  favorites: many(favorites),
  blockedBy: many(issueDependencies, { relationName: "blockedIssue" }),
  blocking: many(issueDependencies, { relationName: "blockingIssue" }),
}));

export const issueLabelsRelations = relations(issueLabels, ({ one }) => ({
  issue: one(issues, {
    fields: [issueLabels.issueId],
    references: [issues.id],
  }),
  label: one(labels, {
    fields: [issueLabels.labelId],
    references: [labels.id],
  }),
}));

export const issueSubscribersRelations = relations(
  issueSubscribers,
  ({ one }) => ({
    issue: one(issues, {
      fields: [issueSubscribers.issueId],
      references: [issues.id],
    }),
    user: one(users, {
      fields: [issueSubscribers.userId],
      references: [users.id],
    }),
  })
);

export const commentsRelations = relations(comments, ({ one, many }) => ({
  issue: one(issues, {
    fields: [comments.issueId],
    references: [issues.id],
  }),
  user: one(users, {
    fields: [comments.userId],
    references: [users.id],
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: "replies",
  }),
  replies: many(comments, { relationName: "replies" }),
  reactions: many(commentReactions),
}));

export const commentReactionsRelations = relations(
  commentReactions,
  ({ one }) => ({
    comment: one(comments, {
      fields: [commentReactions.commentId],
      references: [comments.id],
    }),
    user: one(users, {
      fields: [commentReactions.userId],
      references: [users.id],
    }),
  })
);

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  issue: one(issues, {
    fields: [attachments.issueId],
    references: [issues.id],
  }),
  creator: one(users, {
    fields: [attachments.creatorId],
    references: [users.id],
  }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  issue: one(issues, {
    fields: [activities.issueId],
    references: [issues.id],
  }),
  user: one(users, {
    fields: [activities.userId],
    references: [users.id],
  }),
}));

export const integrationsRelations = relations(integrations, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [integrations.workspaceId],
    references: [workspaces.id],
  }),
  repos: many(integrationRepos),
  webhooks: many(webhooks),
}));

export const forgeRepositoriesRelations = relations(
  forgeRepositories,
  ({ many }) => ({
    projects: many(projects, { relationName: "projectForgeRepository" }),
  })
);

export const integrationReposRelations = relations(
  integrationRepos,
  ({ one, many }) => ({
    integration: one(integrations, {
      fields: [integrationRepos.integrationId],
      references: [integrations.id],
    }),
    project: one(projects, {
      fields: [integrationRepos.projectId],
      references: [projects.id],
    }),
    team: one(teams, {
      fields: [integrationRepos.teamId],
      references: [teams.id],
    }),
    gitLinks: many(issueGitLinks),
  })
);

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [webhooks.workspaceId],
    references: [workspaces.id],
  }),
  integration: one(integrations, {
    fields: [webhooks.integrationId],
    references: [integrations.id],
  }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    webhook: one(webhooks, {
      fields: [webhookDeliveries.webhookId],
      references: [webhooks.id],
    }),
  })
);

export const outboundWebhooksRelations = relations(outboundWebhooks, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [outboundWebhooks.workspaceId],
    references: [workspaces.id],
  }),
  deliveries: many(outboundWebhookDeliveries),
}));

export const outboundWebhookDeliveriesRelations = relations(
  outboundWebhookDeliveries,
  ({ one }) => ({
    webhook: one(outboundWebhooks, {
      fields: [outboundWebhookDeliveries.webhookId],
      references: [outboundWebhooks.id],
    }),
  })
);

export const issueGitLinksRelations = relations(issueGitLinks, ({ one }) => ({
  issue: one(issues, {
    fields: [issueGitLinks.issueId],
    references: [issues.id],
  }),
  integrationRepo: one(integrationRepos, {
    fields: [issueGitLinks.integrationRepoId],
    references: [integrationRepos.id],
  }),
}));

export const issueDependenciesRelations = relations(issueDependencies, ({ one }) => ({
  blockingIssue: one(issues, {
    fields: [issueDependencies.blockingIssueId],
    references: [issues.id],
    relationName: "blockingIssue",
  }),
  blockedIssue: one(issues, {
    fields: [issueDependencies.blockedIssueId],
    references: [issues.id],
    relationName: "blockedIssue",
  }),
  createdBy: one(users, {
    fields: [issueDependencies.createdById],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  issue: one(issues, {
    fields: [notifications.issueId],
    references: [issues.id],
  }),
  actor: one(users, {
    fields: [notifications.actorId],
    references: [users.id],
    relationName: "actor",
  }),
}));

export const customViewsRelations = relations(customViews, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [customViews.workspaceId],
    references: [workspaces.id],
  }),
  team: one(teams, {
    fields: [customViews.teamId],
    references: [teams.id],
  }),
  creator: one(users, {
    fields: [customViews.creatorId],
    references: [users.id],
  }),
  favorites: many(favorites),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, {
    fields: [favorites.userId],
    references: [users.id],
  }),
  issue: one(issues, {
    fields: [favorites.issueId],
    references: [issues.id],
  }),
  project: one(projects, {
    fields: [favorites.projectId],
    references: [projects.id],
  }),
  customView: one(customViews, {
    fields: [favorites.customViewId],
    references: [customViews.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;

export type AgentTaskRun = typeof agentTaskRuns.$inferSelect;
export type NewAgentTaskRun = typeof agentTaskRuns.$inferInsert;

export type IssueArtifact = typeof issueArtifacts.$inferSelect;
export type NewIssueArtifact = typeof issueArtifacts.$inferInsert;

export type ForgeRepository = typeof forgeRepositories.$inferSelect;
export type NewForgeRepository = typeof forgeRepositories.$inferInsert;

export type ForgeRevision = typeof forgeRevisions.$inferSelect;
export type NewForgeRevision = typeof forgeRevisions.$inferInsert;

export type ForgeStack = typeof forgeStacks.$inferSelect;
export type NewForgeStack = typeof forgeStacks.$inferInsert;

export type ForgeRunOverlay = typeof forgeRunOverlays.$inferSelect;
export type NewForgeRunOverlay = typeof forgeRunOverlays.$inferInsert;

export type ForgeBuild = typeof forgeBuilds.$inferSelect;
export type NewForgeBuild = typeof forgeBuilds.$inferInsert;

export type ForgeBuildArtifact = typeof forgeBuildArtifacts.$inferSelect;
export type NewForgeBuildArtifact = typeof forgeBuildArtifacts.$inferInsert;

export type ForgeDeployment = typeof forgeDeployments.$inferSelect;
export type NewForgeDeployment = typeof forgeDeployments.$inferInsert;

export type ForgePreview = typeof forgePreviews.$inferSelect;
export type NewForgePreview = typeof forgePreviews.$inferInsert;

export type ForgeBuildEvent = typeof forgeBuildEvents.$inferSelect;
export type NewForgeBuildEvent = typeof forgeBuildEvents.$inferInsert;


export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type ProjectTeam = typeof projectTeams.$inferSelect;
export type NewProjectTeam = typeof projectTeams.$inferInsert;

export type ProjectRepository = typeof projectRepositories.$inferSelect;
export type NewProjectRepository = typeof projectRepositories.$inferInsert;

export type Cycle = typeof cycles.$inferSelect;
export type NewCycle = typeof cycles.$inferInsert;

export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;

export type Issue = typeof issues.$inferSelect;
export type NewIssue = typeof issues.$inferInsert;

export type IssueLabel = typeof issueLabels.$inferSelect;
export type NewIssueLabel = typeof issueLabels.$inferInsert;

export type IssueSubscriber = typeof issueSubscribers.$inferSelect;
export type NewIssueSubscriber = typeof issueSubscribers.$inferInsert;

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

export type CommentReaction = typeof commentReactions.$inferSelect;
export type NewCommentReaction = typeof commentReactions.$inferInsert;

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;

export type IntegrationRepo = typeof integrationRepos.$inferSelect;
export type NewIntegrationRepo = typeof integrationRepos.$inferInsert;

export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;

export type IssueGitLink = typeof issueGitLinks.$inferSelect;
export type NewIssueGitLink = typeof issueGitLinks.$inferInsert;

export type IssueDependency = typeof issueDependencies.$inferSelect;
export type NewIssueDependency = typeof issueDependencies.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type CustomView = typeof customViews.$inferSelect;
export type NewCustomView = typeof customViews.$inferInsert;

export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;

export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;

// Status/Priority enums for use in code
export const IssueStatus = {
  BACKLOG: "backlog",
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  IN_REVIEW: "in_review",
  DONE: "done",
  CANCELED: "canceled",
} as const;

export const IssuePriority = {
  NO_PRIORITY: "no_priority",
  URGENT: "urgent",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export const ProjectStatus = {
  BACKLOG: "backlog",
  PLANNED: "planned",
  IN_PROGRESS: "in_progress",
  PAUSED: "paused",
  COMPLETED: "completed",
  CANCELED: "canceled",
} as const;

export const CycleStatus = {
  UPCOMING: "upcoming",
  ACTIVE: "active",
  COMPLETED: "completed",
} as const;

export const IssueType = {
  ISSUE: "issue",
  BUG: "bug",
  FEATURE: "feature",
  EPIC: "epic",
} as const;

export const IssueFunnelSourceType = {
  MANUAL: "manual",
  SENTRY: "sentry",
  TICKET: "ticket",
  FORGEGRAPH: "forgegraph",
  API: "api",
} as const;

export const IssueFunnelArtifactType = {
  IDEA: "idea",
  PLAN: "plan",
  BRD: "brd",
  SPEC: "spec",
  TASK: "task",
  PR: "pr",
  RELEASE: "release",
} as const;

export const IssueFunnelStage = {
  DUMPED: "dumped",
  TRIAGED: "triaged",
  PLANNED: "planned",
  DESIGNED: "designed",
  READY_FOR_EXECUTION: "ready_for_execution",
  PICKED_UP: "picked_up",
  STAGING_DEPLOYED: "staging_deployed",
  STAGING_VERIFIED: "staging_verified",
  PRODUCTION_DEPLOYED: "production_deployed",
} as const;

export const IssueFunnelTshirtSize = {
  XS: "xs",
  S: "s",
  M: "m",
  L: "l",
  XL: "xl",
  XXL: "xxl",
} as const;

export const AgentSessionStatus = {
  IDLE: "idle",
  WORKING: "working",
  PAUSED: "paused",
} as const;

export const AgentTaskRunStatus = {
  CLAIMED: "claimed",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  ABANDONED: "abandoned",
  HANDED_OFF: "handed_off",
} as const;
