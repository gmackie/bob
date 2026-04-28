import "server-only";
import { DateTime, Effect } from "effect";

import { AuthRpc } from "@gmacko/contracts/groups/auth";
import { CurrentUser } from "@gmacko/rpc/context";
import {
  ApiKeys,
  AuthMiddleware,
  DeviceCodes,
  InvalidApiKeyError,
  Tenancy,
  TenantNotSelectedError,
} from "@gmacko/core/auth";
import type { ApiKeyId, TenantId } from "@gmacko/core/validators";

import { getServerEnv } from "../env.js";

// ---------------------------------------------------------------------------
// Real handlers for AuthRpc — replaces the deterministic stubs from
// `@gmacko/contracts/stubs/auth`.
//
// Notable shape adapters between service surface (raw Date / shape-shifted
// poll results) and wire surface (DateTimeUtc, contract poll discriminants):
//
//   - `auth.listApiKeys`: service yields raw `Date` for the timestamps; the
//     contract wire schema declares `DateTimeUtcFromString`, whose decoded
//     type is `DateTime.Utc`. We convert with `DateTime.fromDateUnsafe(date)`.
//   - `auth.startDeviceFlow`: service returns `expiresInSeconds` (relative)
//     and no `verificationUri` — the contract wants an absolute `expiresAt`
//     plus a verification URL for the user to visit. We compute both here.
//   - `auth.pollDeviceCode`: service collapses the wire's `consumed` (carries
//     apiKey) and `approved` (no extras) into a single "approved" return
//     shape that bundles plaintext when this caller wins the claim race.
//     The contract wire schema requires a `consumed { apiKey: { id, plaintext } }`
//     branch; the service does NOT surface the issued key id, so we emit `id: ""`
//     for the claim-winner path and degrade lost-race callers (service `consumed`)
//     to wire `consumed { apiKey: { id: "", plaintext: "" } }`. Documented as
//     an acceptable drift at the 6K wire-up; the long-term fix is widening
//     `DeviceCodes.poll` to return the api-key id.
// ---------------------------------------------------------------------------

const verificationUri = () => {
  const env = getServerEnv();
  const baseUrl = env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  return `${baseUrl}/login/device`;
};

// Plain handler map — typed against `AuthRpc.middleware(AuthMiddleware)`
// via `RpcGroup.of` so per-procedure payloads infer correctly. The merged
// group also has `.middleware(AuthMiddleware)` applied in `./index.ts`,
// which excludes `CurrentUser` from the resulting handler layer's residual
// requirement-set when consumed by the merged group's `.toLayer({...})`.
export const authHandlerMap = AuthRpc.middleware(AuthMiddleware).of({
  "auth.whoAmI": () =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      return {
        userId: user.userId as string,
        tenantId: user.tenantId as string,
        email: user.email,
        role: user.role,
      };
    }),

  "auth.listMemberships": () =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const tenancy = yield* Tenancy.asEffect();
      const memberships = yield* tenancy.listMemberships(user.userId);
      return memberships.map((m) => ({
        tenantId: m.tenantId as string,
        role: m.role,
      }));
    }),

  "auth.resolveTenant": ({ tenantIdHint }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const tenancy = yield* Tenancy.asEffect();
      const membership = yield* tenancy.resolveForUser(
        user.userId,
        // Branded TenantId required by the service. The wire payload is a
        // free string, so we hard-cast at the boundary; the service still
        // validates membership existence.
        (tenantIdHint ?? null) as TenantId | null,
      );
      return {
        tenantId: membership.tenantId as string,
        role: membership.role,
      };
    }).pipe(
      // `resolveForUser` can fail with `NotAMemberError` when a hint id is
      // supplied but the user isn't in that tenant. The contract only
      // declares `TenantNotSelectedError`; collapse the membership-mismatch
      // into the same error so the wire channel is single-typed.
      Effect.catchTag("NotAMemberError", (e) =>
        Effect.gen(function* () {
          const tenancy = yield* Tenancy.asEffect();
          const user = yield* CurrentUser.asEffect();
          const memberships = yield* tenancy.listMemberships(user.userId);
          return yield* Effect.fail(
            new TenantNotSelectedError({
              message: `User is not a member of tenant ${e.tenantId}`,
              memberships: memberships.map((m) => ({
                tenantId: m.tenantId as string,
                role: m.role,
              })),
            }),
          );
        }),
      ),
    ),

  "auth.issueApiKey": ({ name, permissions, ttlMs }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const apiKeys = yield* ApiKeys.asEffect();
      const issued = yield* apiKeys.issueKey({
        userId: user.userId,
        tenantId: user.tenantId,
        name,
        permissions: [...permissions],
        ttlMs,
      });
      return {
        id: issued.id as string,
        plaintext: issued.plaintext,
        keyPrefix: issued.keyPrefix,
      };
    }),

  "auth.listApiKeys": () =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const apiKeys = yield* ApiKeys.asEffect();
      const items = yield* apiKeys.listForUser(user.userId, user.tenantId);
      // Service returns `Date | null`; wire expects `DateTimeUtc | null`.
      const toDt = (d: Date | null) => (d ? DateTime.fromDateUnsafe(d) : null);
      return items.map((item) => ({
        id: item.id as string,
        name: item.name,
        keyPrefix: item.keyPrefix,
        permissions: item.permissions,
        createdAt: DateTime.fromDateUnsafe(item.createdAt),
        revokedAt: toDt(item.revokedAt),
        lastUsedAt: toDt(item.lastUsedAt),
        expiresAt: toDt(item.expiresAt),
      }));
    }),

  "auth.revokeApiKey": ({ apiKeyId }) =>
    Effect.gen(function* () {
      // Service `revokeKey` returns `Effect<void, never>` — there's no
      // not-found path at the service layer (UPDATE simply matches 0 rows).
      // The contract declares `InvalidApiKeyError` for the wire; under the
      // current service we treat all calls as best-effort revoke and never
      // emit the error. If the caller passes a malformed id we still return
      // success because the UPDATE silently no-ops; no leakage of existence.
      const apiKeys = yield* ApiKeys.asEffect();
      yield* apiKeys.revokeKey(apiKeyId as ApiKeyId);
      // Reference unused import to keep TS quiet about the contract's
      // declared error class (we don't construct it but the contract wires
      // it).
      void InvalidApiKeyError;
    }),

  "auth.startDeviceFlow": () =>
    Effect.gen(function* () {
      const deviceCodes = yield* DeviceCodes.asEffect();
      const result = yield* deviceCodes.start();
      const expiresAt = DateTime.fromDateUnsafe(
        new Date(Date.now() + result.expiresInSeconds * 1000),
      );
      return {
        deviceCode: result.deviceCode,
        userCode: result.userCode,
        verificationUri: verificationUri(),
        expiresAt,
      };
    }),

  "auth.pollDeviceCode": ({ deviceCode }) =>
    Effect.gen(function* () {
      const deviceCodes = yield* DeviceCodes.asEffect();
      const r = yield* deviceCodes.poll(deviceCode);
      // Wire schema needs the discriminated union {pending|approved|consumed|denied|expired}.
      // Service approved-with-plaintext maps to wire `consumed { apiKey }`.
      // Service consumed (lost race) maps to wire `consumed { apiKey: blanks }`.
      switch (r.status) {
        case "pending":
          return { status: "pending" as const };
        case "denied":
          return { status: "denied" as const };
        case "expired":
          return { status: "expired" as const };
        case "approved":
          return {
            status: "consumed" as const,
            apiKey: { id: "", plaintext: r.plaintextApiKey },
          };
        case "consumed":
          return {
            status: "consumed" as const,
            apiKey: { id: "", plaintext: "" },
          };
      }
    }),

  "auth.approveDeviceCode": ({ userCode, tenantId }) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      const deviceCodes = yield* DeviceCodes.asEffect();
      yield* deviceCodes.approve({
        userCode,
        userId: user.userId,
        tenantId: tenantId as TenantId,
      });
    }),
});
