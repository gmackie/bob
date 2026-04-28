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
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from "@gmacko/core/projects/errors";

import { ProjectSchema } from "../schemas/projects.js";

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

export const ProjectsRpc = RpcGroup.make(
  ProjectsCreateRpc,
  ProjectsListRpc,
  ProjectsGetBySlugRpc,
  ProjectsDeleteRpc,
);
