// Effect service for tenant-scoped projects backed by the `projects` table.
//
// Projects are the shared primitive that downstream Bob/OODA tables extend
// via FK (workspace, ForgeGraph, vault, deploy bindings, etc.). This service
// enforces (tenantId, slug) uniqueness and keeps every read/write tenant-
// scoped; cross-tenant lookups are indistinguishable from "not found" so
// callers can't probe for the existence of another tenant's projects.
//
// Deletes rely on the DB-level `ON DELETE CASCADE` from
// `project_deploy_secret_bindings.projectId -> projects.id` (migration 0003)
// to clean up deploy bindings in the same transaction.
//
// NOTE: not exported from the package barrel yet — Task 13 owns the public
// API surface.
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Layer, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/db";
import { projects as projectsTable } from "@gmacko/db/schema/projects";
import type {
  ProjectId as ProjectIdT,
  TenantId as TenantIdT,
} from "@gmacko/validators";

import {
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from "./errors.js";

// Tagged errors live in `./errors.js` so client bundles can import them
// without dragging in drizzle / @gmacko/db / node:crypto. Re-exported here
// for parity with the pre-refactor public surface.
export { ProjectNotFoundError, ProjectSlugConflictError };

export interface Project {
  readonly id: ProjectIdT;
  readonly tenantId: TenantIdT;
  readonly slug: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProjectsShape {
  readonly createProject: (input: {
    tenantId: TenantIdT;
    slug: string;
    name: string;
  }) => Effect.Effect<Project, ProjectSlugConflictError>;

  readonly listForTenant: (
    tenantId: TenantIdT,
  ) => Effect.Effect<readonly Project[], never>;

  readonly getById: (input: {
    projectId: ProjectIdT;
    tenantId: TenantIdT;
  }) => Effect.Effect<Project, ProjectNotFoundError>;

  readonly getBySlug: (input: {
    tenantId: TenantIdT;
    slug: string;
  }) => Effect.Effect<Project, ProjectNotFoundError>;

  readonly deleteProject: (input: {
    projectId: ProjectIdT;
    tenantId: TenantIdT;
  }) => Effect.Effect<void, ProjectNotFoundError>;
}

export class Projects extends ServiceMap.Service<Projects, ProjectsShape>()(
  "@gmacko/projects/Projects",
) {}

export const layerProjects: Layer.Layer<Projects, never, GmackoDb> =
  Layer.effect(Projects)(
    Effect.gen(function* () {
      const db = yield* GmackoDb;

      const rowToProject = (
        row: typeof projectsTable.$inferSelect,
      ): Project => ({
        id: row.id as ProjectIdT,
        tenantId: row.tenantId as TenantIdT,
        slug: row.slug,
        name: row.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });

      const createProject: ProjectsShape["createProject"] = ({
        tenantId,
        slug,
        name,
      }) =>
        Effect.gen(function* () {
          // Pre-check for existing (tenantId, slug) rather than catching the
          // driver-level unique-violation. This mirrors @gmacko/secrets —
          // @effect/vitest's runPromise logs a defect for driver exceptions
          // even when they are caught structurally via Effect.tryPromise, so
          // we prefer the extra SELECT to keep the failure path inside
          // Effect's error channel. A concurrent insert could still race past
          // us to the unique index, but under test conditions and typical
          // serial call patterns this is sufficient.
          const existing = yield* Effect.promise(async () =>
            db
              .select({ id: projectsTable.id })
              .from(projectsTable)
              .where(
                and(
                  eq(projectsTable.tenantId, tenantId),
                  eq(projectsTable.slug, slug),
                ),
              )
              .limit(1),
          );
          if (existing.length > 0) {
            return yield* Effect.fail(
              new ProjectSlugConflictError({ tenantId, slug }),
            );
          }
          const inserted = yield* Effect.promise(async () =>
            db
              .insert(projectsTable)
              .values({ id: randomUUID(), tenantId, slug, name })
              .returning(),
          );
          return rowToProject(inserted[0]!);
        });

      const listForTenant: ProjectsShape["listForTenant"] = (tenantId) =>
        Effect.promise(async () => {
          const rows = await db
            .select()
            .from(projectsTable)
            .where(eq(projectsTable.tenantId, tenantId))
            .orderBy(desc(projectsTable.createdAt));
          return rows.map(rowToProject);
        });

      const getById: ProjectsShape["getById"] = ({ projectId, tenantId }) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(async () =>
            db
              .select()
              .from(projectsTable)
              .where(
                and(
                  eq(projectsTable.id, projectId),
                  eq(projectsTable.tenantId, tenantId),
                ),
              ),
          );
          if (rows.length === 0) {
            return yield* Effect.fail(
              new ProjectNotFoundError({ tenantId, identifier: projectId }),
            );
          }
          return rowToProject(rows[0]!);
        });

      const getBySlug: ProjectsShape["getBySlug"] = ({ tenantId, slug }) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(async () =>
            db
              .select()
              .from(projectsTable)
              .where(
                and(
                  eq(projectsTable.tenantId, tenantId),
                  eq(projectsTable.slug, slug),
                ),
              ),
          );
          if (rows.length === 0) {
            return yield* Effect.fail(
              new ProjectNotFoundError({ tenantId, identifier: slug }),
            );
          }
          return rowToProject(rows[0]!);
        });

      const deleteProject: ProjectsShape["deleteProject"] = ({
        projectId,
        tenantId,
      }) =>
        Effect.gen(function* () {
          const deleted = yield* Effect.promise(async () =>
            db
              .delete(projectsTable)
              .where(
                and(
                  eq(projectsTable.id, projectId),
                  eq(projectsTable.tenantId, tenantId),
                ),
              )
              .returning(),
          );
          if (deleted.length === 0) {
            return yield* Effect.fail(
              new ProjectNotFoundError({ tenantId, identifier: projectId }),
            );
          }
        });

      return {
        createProject,
        listForTenant,
        getById,
        getBySlug,
        deleteProject,
      } satisfies ProjectsShape;
    }),
  );
