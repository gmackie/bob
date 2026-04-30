// Projects RPC contract group — CRUD over `@gmacko/projects`.
//
// The tagged errors (`ProjectNotFoundError`, `ProjectSlugConflictError`)
// come straight from the source package — they are already
// `Schema.TaggedErrorClass` instances, so they can be used directly as
// the `error:` field without re-declaring them here.
//
// Procedures do NOT take `tenantId` in their payload — the handler reads
// tenancy from `CurrentUser` (populated by `AuthMiddleware`). This keeps
// the wire format clean and avoids clients forging a tenantId.
//
// Phase 7B-4B Task 5: Added project core (get, discovery,
// updateAutomationSettings, dismissDir) and workspace (list, create,
// rename, delete) RPCs — 8 new procedures, 12 total.
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from "@gmacko/core/projects/errors";
import { NotFoundError } from "@gmacko/core/rpc/errors";

import { ProjectSchema } from "../schemas/projects.js";
import {
  WorkspaceSchema,
  WorkspaceMemberSchema,
  AutomationSettingsSchema,
  DiscoveryResultSchema,
} from "../schemas/project-workspace.js";

// ---------------------------------------------------------------------------
// Existing project procedures (Phase 6F)
// ---------------------------------------------------------------------------

export const ProjectsCreateRpc = Rpc.make("projects.create", {
  payload: Schema.Struct({
    slug: Schema.String,
    name: Schema.String,
  }),
  success: ProjectSchema,
  error: ProjectSlugConflictError,
});

export const ProjectsListRpc = Rpc.make("projects.list", {
  payload: Schema.Void,
  success: Schema.Array(ProjectSchema),
});

export const ProjectsGetBySlugRpc = Rpc.make("projects.getBySlug", {
  payload: Schema.Struct({ slug: Schema.String }),
  success: ProjectSchema,
  error: ProjectNotFoundError,
});

export const ProjectsDeleteRpc = Rpc.make("projects.delete", {
  payload: Schema.Struct({ projectId: Schema.String }),
  success: Schema.Void,
  error: ProjectNotFoundError,
});

// ---------------------------------------------------------------------------
// New project core procedures (7B-4B Task 5 — from Bob's project router)
// ---------------------------------------------------------------------------

export const ProjectsGetRpc = Rpc.make("projects.get", {
  payload: Schema.Struct({ id: Schema.String }),
  success: ProjectSchema,
  error: ProjectNotFoundError,
});

export const ProjectsDiscoveryRpc = Rpc.make("projects.discovery", {
  payload: Schema.Struct({ workspaceId: Schema.String }),
  success: DiscoveryResultSchema,
});

export const ProjectsUpdateAutomationSettingsRpc = Rpc.make(
  "projects.updateAutomationSettings",
  {
    payload: Schema.Struct({
      projectId: Schema.String,
      settings: AutomationSettingsSchema,
    }),
    success: ProjectSchema,
    error: ProjectNotFoundError,
  },
);

export const ProjectsDismissDirRpc = Rpc.make("projects.dismissDir", {
  payload: Schema.Struct({ dirId: Schema.String }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  error: NotFoundError,
});

// ---------------------------------------------------------------------------
// Workspace procedures (7B-4B Task 5 — from Bob's workspace router)
// ---------------------------------------------------------------------------

export const ProjectsWorkspaceListRpc = Rpc.make("projects.workspace.list", {
  payload: Schema.Void,
  success: Schema.Array(WorkspaceMemberSchema),
});

export const ProjectsWorkspaceCreateRpc = Rpc.make(
  "projects.workspace.create",
  {
    payload: Schema.Struct({
      name: Schema.String,
      slug: Schema.String,
      description: Schema.optional(Schema.String),
    }),
    success: WorkspaceSchema,
  },
);

export const ProjectsWorkspaceRenameRpc = Rpc.make(
  "projects.workspace.rename",
  {
    payload: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
    success: WorkspaceSchema,
  },
);

export const ProjectsWorkspaceDeleteRpc = Rpc.make(
  "projects.workspace.delete",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ deleted: Schema.Boolean }),
    error: NotFoundError,
  },
);

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export const ProjectsRpc = RpcGroup.make(
  // Existing (Phase 6F)
  ProjectsCreateRpc,
  ProjectsListRpc,
  ProjectsGetBySlugRpc,
  ProjectsDeleteRpc,
  // Project core (7B-4B Task 5)
  ProjectsGetRpc,
  ProjectsDiscoveryRpc,
  ProjectsUpdateAutomationSettingsRpc,
  ProjectsDismissDirRpc,
  // Workspace (7B-4B Task 5)
  ProjectsWorkspaceListRpc,
  ProjectsWorkspaceCreateRpc,
  ProjectsWorkspaceRenameRpc,
  ProjectsWorkspaceDeleteRpc,
);
