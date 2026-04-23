// Deterministic stub handlers for `ProjectsRpc`.
//
// Mounted by consumers via
//   `RpcServer.layerHttp({ group: ProjectsRpc, handlers: stubProjectsHandlersLayer })`.
//
// The handlers are also exported as a plain record (`stubProjectsHandlers`)
// so tests can invoke them directly without spinning up an RpcServer — the
// same record is passed to `ProjectsRpc.toLayer(...)` to produce the
// mountable handlers layer (`stubProjectsHandlersLayer`).
import { Effect } from "effect";

import { ProjectNotFoundError } from "@gmacko/projects";

import { ProjectsRpc } from "../groups/projects.js";
import type { ProjectWire } from "../schemas/projects.js";

export const STUB_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export const STUB_PROJECT_1: ProjectWire = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: STUB_TENANT_ID,
  slug: "acme",
  name: "Acme",
  createdAt: new Date("2026-04-21T12:00:00Z"),
  updatedAt: new Date("2026-04-21T12:00:00Z"),
};

export const STUB_PROJECT_2: ProjectWire = {
  id: "22222222-2222-2222-2222-222222222222",
  tenantId: STUB_TENANT_ID,
  slug: "oodadocs",
  name: "OODA Docs",
  createdAt: new Date("2026-04-20T12:00:00Z"),
  updatedAt: new Date("2026-04-20T12:00:00Z"),
};

const STUB_CREATED_PROJECT_ID = "99999999-9999-9999-9999-999999999999";

/**
 * Deterministic handler record. Exported so tests can invoke handlers
 * directly; production code passes this to `ProjectsRpc.toLayer(...)` via
 * `stubProjectsHandlersLayer`.
 */
export const stubProjectsHandlers = {
  "projects.create": ({ slug, name }: { slug: string; name: string }) => {
    const now = new Date("2026-04-21T12:00:00Z");
    return Effect.succeed({
      id: STUB_CREATED_PROJECT_ID,
      tenantId: STUB_TENANT_ID,
      slug,
      name,
      createdAt: now,
      updatedAt: now,
    } satisfies ProjectWire);
  },
  "projects.list": () =>
    Effect.succeed([STUB_PROJECT_1, STUB_PROJECT_2] as const),
  "projects.getBySlug": ({ slug }: { slug: string }) => {
    if (slug === STUB_PROJECT_1.slug) return Effect.succeed(STUB_PROJECT_1);
    if (slug === STUB_PROJECT_2.slug) return Effect.succeed(STUB_PROJECT_2);
    return Effect.fail(
      new ProjectNotFoundError({
        tenantId: STUB_TENANT_ID,
        identifier: slug,
      }),
    );
  },
  "projects.delete": ({ projectId }: { projectId: string }) => {
    if (
      projectId === STUB_PROJECT_1.id ||
      projectId === STUB_PROJECT_2.id ||
      projectId === STUB_CREATED_PROJECT_ID
    ) {
      return Effect.void;
    }
    return Effect.fail(
      new ProjectNotFoundError({
        tenantId: STUB_TENANT_ID,
        identifier: projectId,
      }),
    );
  },
} as const;

/** Layer form — pass to `RpcServer.layerHttp({ group, handlers })`. */
export const stubProjectsHandlersLayer = ProjectsRpc.toLayer(
  stubProjectsHandlers,
);
