import "server-only";
import { Effect } from "effect";

import { ProjectsRpc } from "@gmacko/contracts/groups/projects";
import { CurrentUser } from "@gmacko/rpc/context";
import { AuthMiddleware } from "@gmacko/core/auth";
import { Projects } from "@gmacko/core/projects";
import type { ProjectId } from "@gmacko/core/validators";

// Real handlers for ProjectsRpc — replaces the deterministic stubs from
// `@gmacko/contracts/stubs/projects`. Tenant scope is read from CurrentUser
// (populated by AuthMiddleware), NOT from the wire payload.
//
// Each handler returns the service's plain `Project` value directly. The
// wire schema (`ProjectSchema`) uses `Schema.Date`, which round-trips raw
// JS Dates through unchanged on encode — no DateTime conversion needed
// here, unlike `auth.listApiKeys`.

export const projectsHandlerMap = ProjectsRpc.middleware(AuthMiddleware).of({
  "projects.create": ({ slug, name }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const projects = yield* Projects.asEffect();
      const project = yield* projects.createProject({
        tenantId: user.tenantId,
        slug,
        name,
      });
      return {
        id: project.id as string,
        tenantId: project.tenantId as string,
        slug: project.slug,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    }),

  "projects.list": () =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const projects = yield* Projects.asEffect();
      const list = yield* projects.listForTenant(user.tenantId);
      return list.map((project) => ({
        id: project.id as string,
        tenantId: project.tenantId as string,
        slug: project.slug,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      }));
    }),

  "projects.getBySlug": ({ slug }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const projects = yield* Projects.asEffect();
      const project = yield* projects.getBySlug({
        tenantId: user.tenantId,
        slug,
      });
      return {
        id: project.id as string,
        tenantId: project.tenantId as string,
        slug: project.slug,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    }),

  "projects.delete": ({ projectId }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const projects = yield* Projects.asEffect();
      yield* projects.deleteProject({
        projectId: projectId as ProjectId,
        tenantId: user.tenantId,
      });
    }),
});
