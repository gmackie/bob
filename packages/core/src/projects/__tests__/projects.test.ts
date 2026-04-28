import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@gmacko/core/db/testing";
import { layerGmackoDb } from "@gmacko/core/db";
import { tenants } from "@gmacko/core/db/schema/tenancy";
import {
  sessionSecrets,
  projectDeploySecretBindings,
} from "@gmacko/core/db/schema/secrets";
import type { ProjectId, TenantId } from "@gmacko/core/validators";

import {
  Projects,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  layerProjects,
} from "../projects.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" as TenantId;
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" as TenantId;

let ctx: TestCtx;
let projectsLayer: Layer.Layer<Projects>;

async function seedTenant(ctx: TestCtx, id: TenantId, slug: string) {
  await ctx.db.insert(tenants).values({
    id,
    name: `Tenant ${slug}`,
    slug,
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(async () => {
  ctx = await createTestDb();
  projectsLayer = Layer.provide(layerProjects, layerGmackoDb(ctx.db));
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/projects Projects service", () => {
  it.effect("createProject round-trips id, tenantId, slug, name, and Date timestamps", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedTenant(ctx, TENANT_A, "tenant-a"));
      const svc = yield* Projects.asEffect();
      const project = yield* svc.createProject({
        tenantId: TENANT_A,
        slug: "acme",
        name: "Acme",
      });
      expect(project.id).toMatch(UUID_RE);
      expect(project.tenantId).toBe(TENANT_A);
      expect(project.slug).toBe("acme");
      expect(project.name).toBe("Acme");
      expect(project.createdAt).toBeInstanceOf(Date);
      expect(project.updatedAt).toBeInstanceOf(Date);
    }).pipe(Effect.provide(projectsLayer)),
  );

  it.effect("createProject with duplicate (tenantId, slug) fails with ProjectSlugConflictError", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedTenant(ctx, TENANT_A, "tenant-a"));
      const svc = yield* Projects.asEffect();
      yield* svc.createProject({
        tenantId: TENANT_A,
        slug: "acme",
        name: "Acme",
      });
      const caught = yield* svc
        .createProject({
          tenantId: TENANT_A,
          slug: "acme",
          name: "Acme Again",
        })
        .pipe(
          Effect.catchTag("ProjectSlugConflictError", (err) =>
            Effect.succeed(err),
          ),
        );
      expect(caught).toBeInstanceOf(ProjectSlugConflictError);
      expect((caught as ProjectSlugConflictError).tenantId).toBe(TENANT_A);
      expect((caught as ProjectSlugConflictError).slug).toBe("acme");
    }).pipe(Effect.provide(projectsLayer)),
  );

  it.effect("different tenants can share a slug", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedTenant(ctx, TENANT_A, "tenant-a"));
      yield* Effect.promise(() => seedTenant(ctx, TENANT_B, "tenant-b"));
      const svc = yield* Projects.asEffect();
      const a = yield* svc.createProject({
        tenantId: TENANT_A,
        slug: "shared",
        name: "Shared A",
      });
      const b = yield* svc.createProject({
        tenantId: TENANT_B,
        slug: "shared",
        name: "Shared B",
      });
      expect(a.tenantId).toBe(TENANT_A);
      expect(b.tenantId).toBe(TENANT_B);

      const listA = yield* svc.listForTenant(TENANT_A);
      const listB = yield* svc.listForTenant(TENANT_B);
      expect(listA).toHaveLength(1);
      expect(listA[0]!.id).toBe(a.id);
      expect(listB).toHaveLength(1);
      expect(listB[0]!.id).toBe(b.id);
    }).pipe(Effect.provide(projectsLayer)),
  );

  it.effect("getById, getBySlug, and listForTenant are tenant-scoped", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedTenant(ctx, TENANT_A, "tenant-a"));
      yield* Effect.promise(() => seedTenant(ctx, TENANT_B, "tenant-b"));
      const svc = yield* Projects.asEffect();
      const p = yield* svc.createProject({
        tenantId: TENANT_A,
        slug: "alpha",
        name: "Alpha",
      });

      // getById with wrong tenant -> NotFound
      const byIdCross = yield* svc
        .getById({ projectId: p.id, tenantId: TENANT_B })
        .pipe(
          Effect.catchTag("ProjectNotFoundError", (err) => Effect.succeed(err)),
        );
      expect(byIdCross).toBeInstanceOf(ProjectNotFoundError);
      expect((byIdCross as ProjectNotFoundError).tenantId).toBe(TENANT_B);
      expect((byIdCross as ProjectNotFoundError).identifier).toBe(p.id);

      // getBySlug with wrong tenant -> NotFound
      const bySlugCross = yield* svc
        .getBySlug({ tenantId: TENANT_B, slug: p.slug })
        .pipe(
          Effect.catchTag("ProjectNotFoundError", (err) => Effect.succeed(err)),
        );
      expect(bySlugCross).toBeInstanceOf(ProjectNotFoundError);
      expect((bySlugCross as ProjectNotFoundError).tenantId).toBe(TENANT_B);
      expect((bySlugCross as ProjectNotFoundError).identifier).toBe(p.slug);

      // listForTenant for the other tenant is empty (not an error)
      const listB = yield* svc.listForTenant(TENANT_B);
      expect(listB).toEqual([]);

      // Happy path: owning tenant resolves the project
      const got = yield* svc.getById({
        projectId: p.id,
        tenantId: TENANT_A,
      });
      expect(got.id).toBe(p.id);
      expect(got.slug).toBe("alpha");
    }).pipe(Effect.provide(projectsLayer)),
  );

  it.effect("deleteProject cross-tenant fails with ProjectNotFoundError and leaves the row intact", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedTenant(ctx, TENANT_A, "tenant-a"));
      yield* Effect.promise(() => seedTenant(ctx, TENANT_B, "tenant-b"));
      const svc = yield* Projects.asEffect();
      const p = yield* svc.createProject({
        tenantId: TENANT_A,
        slug: "alpha",
        name: "Alpha",
      });
      const caught = yield* svc
        .deleteProject({ projectId: p.id, tenantId: TENANT_B })
        .pipe(
          Effect.catchTag("ProjectNotFoundError", (err) => Effect.succeed(err)),
        );
      expect(caught).toBeInstanceOf(ProjectNotFoundError);
      expect((caught as ProjectNotFoundError).tenantId).toBe(TENANT_B);
      expect((caught as ProjectNotFoundError).identifier).toBe(p.id);

      // Confirm the project still exists under the owning tenant.
      const still = yield* svc.getById({
        projectId: p.id,
        tenantId: TENANT_A,
      });
      expect(still.id).toBe(p.id);
    }).pipe(Effect.provide(projectsLayer)),
  );

  it.effect("deleteProject cascades to project_deploy_secret_bindings", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedTenant(ctx, TENANT_A, "tenant-a"));
      const svc = yield* Projects.asEffect();
      const project = yield* svc.createProject({
        tenantId: TENANT_A,
        slug: "deploy-target",
        name: "Deploy Target",
      });

      // Seed one session_secret (dummy encryption payload — we only care about
      // the FK cascade chain, not the crypto).
      const secretId = crypto.randomUUID();
      const iv = crypto.randomBytes(12).toString("base64");
      const authTag = crypto.randomBytes(16).toString("base64");
      yield* Effect.promise(() =>
        ctx.db.insert(sessionSecrets).values({
          id: secretId,
          tenantId: TENANT_A,
          name: "DEPLOY_TOKEN",
          ciphertext: "ABCD",
          iv,
          authTag,
        }),
      );

      // Bind it to the project.
      yield* Effect.promise(() =>
        ctx.db.insert(projectDeploySecretBindings).values({
          tenantId: TENANT_A,
          secretId,
          projectId: project.id,
          deployEnvironment: "production",
          deployEnvVarName: "DEPLOY_TOKEN",
        }),
      );

      // Sanity: the binding exists before deletion.
      const before = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(projectDeploySecretBindings)
          .where(eq(projectDeploySecretBindings.projectId, project.id)),
      );
      expect(before).toHaveLength(1);

      yield* svc.deleteProject({
        projectId: project.id,
        tenantId: TENANT_A,
      });

      // The FK `ON DELETE CASCADE` from projects -> bindings should have fired.
      const after = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(projectDeploySecretBindings)
          .where(
            and(
              eq(projectDeploySecretBindings.projectId, project.id),
              eq(projectDeploySecretBindings.tenantId, TENANT_A),
            ),
          ),
      );
      expect(after).toEqual([]);
    }).pipe(Effect.provide(projectsLayer)),
  );
});
