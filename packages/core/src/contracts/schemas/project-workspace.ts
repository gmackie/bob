// Wire schemas for Workspace, WorkspaceMember, DiscoveryResult, and
// AutomationSettings — supporting the project core + workspace RPCs
// added in Phase 7B-4B Task 5.
//
// Translated from Bob's Zod schemas in:
//   - packages/bob/src/api/src/router/workspace.ts
//   - packages/bob/src/api/src/router/project.ts
//
// UUID fields use plain `Schema.String` on the wire (matching auth/projects
// convention); validation can be tightened at handler time.
import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const WorkspaceSchema = Schema.Struct({
  id: Schema.String, // UUID
  ownerUserId: Schema.String, // UUID
  name: Schema.String,
  slug: Schema.String,
  description: Schema.NullOr(Schema.String),
  defaultAgentType: Schema.optional(Schema.NullOr(Schema.String)),
  forgeAvailable: Schema.optional(Schema.Boolean),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type WorkspaceWire = typeof WorkspaceSchema.Type;

export const WorkspaceMemberSchema = Schema.Struct({
  id: Schema.String, // UUID
  workspaceId: Schema.String, // UUID
  userId: Schema.String, // UUID
  role: Schema.Literals(["owner", "admin", "member"]),
  joinedAt: Schema.DateTimeUtcFromString,
  workspace: Schema.optional(WorkspaceSchema),
});
export type WorkspaceMemberWire = typeof WorkspaceMemberSchema.Type;

// ---------------------------------------------------------------------------
// Automation settings (project.updateAutomationSettings payload)
// ---------------------------------------------------------------------------

export const StageSkillSchema = Schema.Struct({
  slug: Schema.String,
  label: Schema.String,
  enabled: Schema.Boolean,
});

export const AutomationSettingsSchema = Schema.Struct({
  autoDispatch: Schema.optional(Schema.Boolean),
  autoBranch: Schema.optional(Schema.Boolean),
  autoFeaturePR: Schema.optional(Schema.Boolean),
  ciTrigger: Schema.optional(Schema.Boolean),
  reactFrontend: Schema.optional(Schema.Boolean),
  stageSkills: Schema.optional(
    Schema.Record(Schema.String, Schema.Array(StageSkillSchema)),
  ),
});
export type AutomationSettingsWire = typeof AutomationSettingsSchema.Type;

// ---------------------------------------------------------------------------
// Discovery result (projects.discovery response)
// ---------------------------------------------------------------------------

export const DiscoveryRepoSchema = Schema.Struct({
  id: Schema.String, // UUID
  name: Schema.String,
  path: Schema.NullOr(Schema.String),
  remoteProvider: Schema.NullOr(Schema.String),
  remoteOwner: Schema.NullOr(Schema.String),
  remoteName: Schema.NullOr(Schema.String),
  remoteUrl: Schema.NullOr(Schema.String),
  stale: Schema.Boolean,
});

export const DiscoveryLinkedRepoSchema = Schema.Struct({
  ...DiscoveryRepoSchema.fields,
  project: Schema.optional(Schema.Unknown), // Simplified — full project shape varies
});

export const DiscoveredDirSchema = Schema.Struct({
  id: Schema.String, // UUID
  workspaceId: Schema.String, // UUID
  path: Schema.String,
  dismissed: Schema.Boolean,
});

export const DiscoveryResultSchema = Schema.Struct({
  forgeAvailable: Schema.Boolean,
  linked: Schema.Array(DiscoveryLinkedRepoSchema),
  forgeReady: Schema.Array(DiscoveryRepoSchema),
  gitOnly: Schema.Array(DiscoveryRepoSchema),
  nonGit: Schema.Array(DiscoveredDirSchema),
});
export type DiscoveryResultWire = typeof DiscoveryResultSchema.Type;
