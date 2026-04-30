// Deterministic stub handlers for `ProjectsRpc`.
//
// Mounted by consumers via
//   `RpcServer.layerHttp({ group: ProjectsRpc, handlers: stubProjectsHandlersLayer })`.
//
// The handlers are also exported as a plain record (`stubProjectsHandlers`)
// so tests can invoke them directly without spinning up an RpcServer — the
// same record is passed to `ProjectsRpc.toLayer(...)` to produce the
// mountable handlers layer (`stubProjectsHandlersLayer`).
//
// Phase 7B-4B Task 5: Added stubs for 8 new procedures (project core +
// workspace) — 12 handlers total.
import { Effect } from "effect";

import { ProjectNotFoundError } from "@gmacko/core/projects/errors";
import { NotFoundError } from "@gmacko/core/rpc/errors";

import { ProjectsRpc } from "../groups/projects.js";
import type { ProjectWire } from "../schemas/projects.js";
import type {
  WorkspaceWire,
  WorkspaceMemberWire,
  DiscoveryResultWire,
} from "../schemas/project-workspace.js";

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

export const STUB_WORKSPACE_1: WorkspaceWire = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  ownerUserId: "00000000-0000-0000-0000-000000000099",
  name: "Acme Workspace",
  slug: "acme-ws",
  description: null,
  createdAt: "2026-04-21T12:00:00Z",
  updatedAt: "2026-04-21T12:00:00Z",
};

export const STUB_WORKSPACE_MEMBER_1: WorkspaceMemberWire = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  workspaceId: STUB_WORKSPACE_1.id,
  userId: "00000000-0000-0000-0000-000000000099",
  role: "owner",
  joinedAt: "2026-04-21T12:00:00Z",
  workspace: STUB_WORKSPACE_1,
};

export const STUB_DISCOVERY_RESULT: DiscoveryResultWire = {
  forgeAvailable: false,
  linked: [],
  forgeReady: [],
  gitOnly: [],
  nonGit: [],
};

/**
 * Deterministic handler record. Exported so tests can invoke handlers
 * directly; production code passes this to `ProjectsRpc.toLayer(...)` via
 * `stubProjectsHandlersLayer`.
 */
export const stubProjectsHandlers = {
  // --- Existing (Phase 6F) -----------------------------------------------
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

  // --- Project core (7B-4B Task 5) ---------------------------------------
  "projects.get": ({ id }: { id: string }) => {
    if (id === STUB_PROJECT_1.id) return Effect.succeed(STUB_PROJECT_1);
    if (id === STUB_PROJECT_2.id) return Effect.succeed(STUB_PROJECT_2);
    return Effect.fail(
      new ProjectNotFoundError({
        tenantId: STUB_TENANT_ID,
        identifier: id,
      }),
    );
  },
  "projects.discovery": (_payload: { workspaceId: string }) =>
    Effect.succeed(STUB_DISCOVERY_RESULT),
  "projects.updateAutomationSettings": ({
    projectId,
  }: {
    projectId: string;
    settings: Record<string, unknown>;
  }) => {
    if (projectId === STUB_PROJECT_1.id)
      return Effect.succeed(STUB_PROJECT_1);
    if (projectId === STUB_PROJECT_2.id)
      return Effect.succeed(STUB_PROJECT_2);
    return Effect.fail(
      new ProjectNotFoundError({
        tenantId: STUB_TENANT_ID,
        identifier: projectId,
      }),
    );
  },
  "projects.dismissDir": ({ dirId }: { dirId: string }) => {
    if (dirId === "00000000-0000-0000-0000-000000000000") {
      return Effect.fail(
        new NotFoundError({ entity: "DiscoveredDir", id: dirId }),
      );
    }
    return Effect.succeed({ ok: true as const });
  },

  // --- Workspace (7B-4B Task 5) ------------------------------------------
  "projects.workspace.list": () =>
    Effect.succeed([STUB_WORKSPACE_MEMBER_1]),
  "projects.workspace.create": ({
    name,
    slug,
    description,
  }: {
    name: string;
    slug: string;
    description?: string;
  }) =>
    Effect.succeed({
      ...STUB_WORKSPACE_1,
      name,
      slug,
      description: description ?? null,
    } satisfies WorkspaceWire),
  "projects.workspace.rename": ({
    id,
    name,
  }: {
    id: string;
    name: string;
  }) => {
    if (id === STUB_WORKSPACE_1.id) {
      return Effect.succeed({ ...STUB_WORKSPACE_1, name } satisfies WorkspaceWire);
    }
    return Effect.fail(
      new NotFoundError({ entity: "Workspace", id }),
    );
  },
  "projects.workspace.delete": ({ id }: { id: string }) => {
    if (id === STUB_WORKSPACE_1.id) {
      return Effect.succeed({ deleted: true as const });
    }
    return Effect.fail(
      new NotFoundError({ entity: "Workspace", id }),
    );
  },
} as const;

/** Layer form — pass to `RpcServer.layerHttp({ group, handlers })`. */
export const stubProjectsHandlersLayer = ProjectsRpc.toLayer(
  stubProjectsHandlers,
);
