import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/db/testing";
import { layerGmackoDb } from "@gmacko/db";
import { users } from "@gmacko/db/schema/auth";
import { tenants, tenantMembers } from "@gmacko/db/schema/tenancy";
import type { TenantId, TenantMemberRole, UserId } from "@gmacko/core/validators";

import {
  Tenancy,
  NotAMemberError,
  InsufficientRoleError,
  TenantNotSelectedError,
  layerTenancy,
} from "../tenancy.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const USER_ID = "user_tenancy_abc" as UserId;
const USER_EMAIL = "tenancy-user@example.com";
const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" as TenantId;
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" as TenantId;
const TENANT_C = "cccccccc-cccc-cccc-cccc-cccccccccccc" as TenantId;

let ctx: TestCtx;
let tenancyLayer: Layer.Layer<Tenancy>;

/**
 * Seed a single user + the listed tenants, then insert a membership row for
 * each `[tenantId, role]` pair. Tenants are created idempotently (one slug
 * per tenant id).
 */
async function seed(
  ctx: TestCtx,
  memberships: ReadonlyArray<{ tenantId: TenantId; role: TenantMemberRole }>,
) {
  await ctx.db.insert(users).values({
    id: USER_ID,
    name: "Tenancy Test User",
    email: USER_EMAIL,
  });
  // Collect the unique tenants we need to insert for these memberships.
  const allTenantIds = new Set(memberships.map((m) => m.tenantId));
  for (const tid of allTenantIds) {
    await ctx.db.insert(tenants).values({
      id: tid,
      name: `Tenant ${tid.slice(0, 4)}`,
      slug: `tenant-${tid.slice(0, 8)}`,
    });
  }
  for (const m of memberships) {
    await ctx.db.insert(tenantMembers).values({
      tenantId: m.tenantId,
      userId: USER_ID,
      role: m.role,
    });
  }
}

beforeEach(async () => {
  ctx = await createTestDb();
  tenancyLayer = Layer.provide(layerTenancy, layerGmackoDb(ctx.db));
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/auth Tenancy service", () => {
  it.effect("listMemberships returns 0 entries when the user has no memberships", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seed(ctx, []));
      const svc = yield* Tenancy.asEffect();
      const list = yield* svc.listMemberships(USER_ID);
      expect(list).toEqual([]);
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("listMemberships returns all memberships (content, not order)", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [
          { tenantId: TENANT_A, role: "owner" },
          { tenantId: TENANT_B, role: "admin" },
          { tenantId: TENANT_C, role: "member" },
        ]),
      );
      const svc = yield* Tenancy.asEffect();
      const list = yield* svc.listMemberships(USER_ID);
      expect(list).toHaveLength(3);
      expect(list).toEqual(
        expect.arrayContaining([
          { tenantId: TENANT_A, role: "owner" },
          { tenantId: TENANT_B, role: "admin" },
          { tenantId: TENANT_C, role: "member" },
        ]),
      );
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("assertMembership returns the role when the user is a member", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [{ tenantId: TENANT_A, role: "admin" }]),
      );
      const svc = yield* Tenancy.asEffect();
      const role = yield* svc.assertMembership(USER_ID, TENANT_A);
      expect(role).toBe("admin");
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("assertMembership fails with NotAMemberError when the user isn't a member", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [{ tenantId: TENANT_A, role: "owner" }]),
      );
      const svc = yield* Tenancy.asEffect();
      const caught = yield* svc.assertMembership(USER_ID, TENANT_B).pipe(
        Effect.catchTag("NotAMemberError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(NotAMemberError);
      expect((caught as NotAMemberError).tenantId).toBe(TENANT_B);
      expect((caught as NotAMemberError).userId).toBe(USER_ID);
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("assertRole passes when actual === required", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [{ tenantId: TENANT_A, role: "admin" }]),
      );
      const svc = yield* Tenancy.asEffect();
      // Should succeed with no error.
      yield* svc.assertRole(USER_ID, TENANT_A, "admin");
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("assertRole passes when actual outranks required (owner >= admin, admin >= member)", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [
          { tenantId: TENANT_A, role: "owner" },
          { tenantId: TENANT_B, role: "admin" },
        ]),
      );
      const svc = yield* Tenancy.asEffect();
      yield* svc.assertRole(USER_ID, TENANT_A, "admin");
      yield* svc.assertRole(USER_ID, TENANT_A, "member");
      yield* svc.assertRole(USER_ID, TENANT_B, "member");
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("assertRole fails with InsufficientRoleError when actual < required", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [{ tenantId: TENANT_A, role: "member" }]),
      );
      const svc = yield* Tenancy.asEffect();
      const caught = yield* svc.assertRole(USER_ID, TENANT_A, "admin").pipe(
        Effect.catchTag("InsufficientRoleError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(InsufficientRoleError);
      expect((caught as InsufficientRoleError).required).toBe("admin");
      expect((caught as InsufficientRoleError).actual).toBe("member");
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("assertRole surfaces NotAMemberError when the user isn't a member of the tenant", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [{ tenantId: TENANT_A, role: "owner" }]),
      );
      const svc = yield* Tenancy.asEffect();
      const caught = yield* svc.assertRole(USER_ID, TENANT_B, "member").pipe(
        Effect.catchTag("NotAMemberError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(NotAMemberError);
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("resolveForUser with a hint tenantId + membership returns that membership", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [
          { tenantId: TENANT_A, role: "owner" },
          { tenantId: TENANT_B, role: "member" },
        ]),
      );
      const svc = yield* Tenancy.asEffect();
      const m = yield* svc.resolveForUser(USER_ID, TENANT_B);
      expect(m.tenantId).toBe(TENANT_B);
      expect(m.role).toBe("member");
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("resolveForUser with a hint but no membership fails with NotAMemberError", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [{ tenantId: TENANT_A, role: "owner" }]),
      );
      const svc = yield* Tenancy.asEffect();
      const caught = yield* svc.resolveForUser(USER_ID, TENANT_B).pipe(
        Effect.catchTag("NotAMemberError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(NotAMemberError);
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("resolveForUser with no hint + exactly one membership auto-selects it", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [{ tenantId: TENANT_A, role: "owner" }]),
      );
      const svc = yield* Tenancy.asEffect();
      const m = yield* svc.resolveForUser(USER_ID, null);
      expect(m.tenantId).toBe(TENANT_A);
      expect(m.role).toBe("owner");
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("resolveForUser with no hint + zero memberships fails with TenantNotSelectedError", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seed(ctx, []));
      const svc = yield* Tenancy.asEffect();
      const caught = yield* svc.resolveForUser(USER_ID, null).pipe(
        Effect.catchTag("TenantNotSelectedError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(TenantNotSelectedError);
      expect((caught as TenantNotSelectedError).memberships).toEqual([]);
      expect((caught as TenantNotSelectedError).message).toContain("no tenant memberships");
    }).pipe(Effect.provide(tenancyLayer)),
  );

  it.effect("resolveForUser with no hint + multiple memberships fails with TenantNotSelectedError listing them", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        seed(ctx, [
          { tenantId: TENANT_A, role: "owner" },
          { tenantId: TENANT_B, role: "member" },
        ]),
      );
      const svc = yield* Tenancy.asEffect();
      const caught = yield* svc.resolveForUser(USER_ID, null).pipe(
        Effect.catchTag("TenantNotSelectedError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(TenantNotSelectedError);
      expect((caught as TenantNotSelectedError).message).toContain("multiple memberships");
      const memberships = (caught as TenantNotSelectedError).memberships;
      expect(memberships).toHaveLength(2);
      expect(memberships).toEqual(
        expect.arrayContaining([
          { tenantId: TENANT_A, role: "owner" },
          { tenantId: TENANT_B, role: "member" },
        ]),
      );
    }).pipe(Effect.provide(tenancyLayer)),
  );
});
