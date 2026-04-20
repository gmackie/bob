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
import { Effect, Layer, Schema, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/db";
import { tenantMembers } from "@gmacko/db/schema/tenancy";
import {
  TenantMemberRole,
  type TenantId,
  type TenantMemberRole as Role,
  type UserId,
} from "@gmacko/validators";

// Tagged errors. We deliberately use `Schema.String` for the branded id
// fields (UserId, TenantId) to keep the tagged errors structural and avoid
// running the brand decoders at construct time — the branding is enforced
// by the service method signatures at the boundary.
export class NotAMemberError extends Schema.TaggedErrorClass<NotAMemberError>()(
  "NotAMemberError",
  { userId: Schema.String, tenantId: Schema.String },
) {}

export class InsufficientRoleError extends Schema.TaggedErrorClass<InsufficientRoleError>()(
  "InsufficientRoleError",
  {
    required: TenantMemberRole,
    actual: TenantMemberRole,
  },
) {}

export class TenantNotSelectedError extends Schema.TaggedErrorClass<TenantNotSelectedError>()(
  "TenantNotSelectedError",
  {
    message: Schema.String,
    memberships: Schema.Array(
      Schema.Struct({ tenantId: Schema.String, role: TenantMemberRole }),
    ),
  },
) {}

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
