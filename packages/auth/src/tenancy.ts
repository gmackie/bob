// Effect service for tenancy: memberships, role assertions, and Option-B
// tenant resolution (hint-header wins, else single-membership auto-selects,
// else picker-error).
//
// Used by the RPC auth middleware (Task 15) to pick the active tenant for a
// request. The service also exposes `assertMembership` / `assertRole` for
// RPC handlers that need tenant-scoped authorization.
//
// NOTE: not exported from the package barrel yet — Task 17 handles the
// public surface.
import { and, eq } from "drizzle-orm";
import { Effect, Layer, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/db";
import { tenantMembers } from "@gmacko/db/schema/tenancy";
import {
  type TenantId,
  type TenantMemberRole as Role,
  type UserId,
} from "@gmacko/validators";

// Tagged errors are hoisted to ./errors.js so client bundles can import them
// without dragging in @gmacko/db / drizzle / node:* via this module. See
// docs/plans/2026-04-25-phase7a-punchlist.md Task 6.
import {
  InsufficientRoleError,
  NotAMemberError,
  TenantNotSelectedError,
} from "./errors.js";

export { InsufficientRoleError, NotAMemberError, TenantNotSelectedError };

export interface Membership {
  readonly tenantId: TenantId;
  readonly role: Role;
}

export interface TenancyShape {
  readonly listMemberships: (
    userId: UserId,
  ) => Effect.Effect<readonly Membership[], never>;
  readonly assertMembership: (
    userId: UserId,
    tenantId: TenantId,
  ) => Effect.Effect<Role, NotAMemberError>;
  readonly assertRole: (
    userId: UserId,
    tenantId: TenantId,
    atLeast: Role,
  ) => Effect.Effect<void, NotAMemberError | InsufficientRoleError>;
  readonly resolveForUser: (
    userId: UserId,
    hintTenantId: TenantId | null,
  ) => Effect.Effect<Membership, NotAMemberError | TenantNotSelectedError>;
}

export class Tenancy extends ServiceMap.Service<Tenancy, TenancyShape>()(
  "@gmacko/auth/Tenancy",
) {}

/** Numeric role precedence for role comparison: member < admin < owner. */
const ROLE_RANK: Record<Role, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

export const layerTenancy: Layer.Layer<Tenancy, never, GmackoDb> = Layer.effect(
  Tenancy,
)(
  Effect.gen(function* () {
    const db = yield* GmackoDb;

    const listMemberships: TenancyShape["listMemberships"] = (userId) =>
      Effect.promise(async () => {
        const rows = await db
          .select({
            tenantId: tenantMembers.tenantId,
            role: tenantMembers.role,
          })
          .from(tenantMembers)
          .where(eq(tenantMembers.userId, userId));
        return rows.map((r) => ({
          tenantId: r.tenantId as TenantId,
          role: r.role as Role,
        }));
      });

    const assertMembership: TenancyShape["assertMembership"] = (
      userId,
      tenantId,
    ) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db
            .select({ role: tenantMembers.role })
            .from(tenantMembers)
            .where(
              and(
                eq(tenantMembers.userId, userId),
                eq(tenantMembers.tenantId, tenantId),
              ),
            )
            .limit(1),
        );
        const row = rows[0];
        if (!row) {
          return yield* Effect.fail(
            new NotAMemberError({ userId, tenantId }),
          );
        }
        return row.role as Role;
      });

    const assertRole: TenancyShape["assertRole"] = (userId, tenantId, atLeast) =>
      Effect.gen(function* () {
        const actual = yield* assertMembership(userId, tenantId);
        if (ROLE_RANK[actual] < ROLE_RANK[atLeast]) {
          return yield* Effect.fail(
            new InsufficientRoleError({ required: atLeast, actual }),
          );
        }
      });

    const resolveForUser: TenancyShape["resolveForUser"] = (
      userId,
      hintTenantId,
    ) =>
      Effect.gen(function* () {
        if (hintTenantId) {
          const role = yield* assertMembership(userId, hintTenantId);
          return { tenantId: hintTenantId, role };
        }
        const memberships = yield* listMemberships(userId);
        if (memberships.length === 1) {
          return memberships[0]!;
        }
        return yield* Effect.fail(
          new TenantNotSelectedError({
            message:
              memberships.length === 0
                ? "User has no tenant memberships"
                : "User must select a tenant (multiple memberships)",
            memberships: memberships.map((m) => ({
              tenantId: m.tenantId,
              role: m.role,
            })),
          }),
        );
      });

    return { listMemberships, assertMembership, assertRole, resolveForUser };
  }),
);
