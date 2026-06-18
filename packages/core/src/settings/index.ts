// @gmacko/settings — Phase 6L peripheral package stub.
//
// Public surface:
//   - `Settings` — Effect service: get/update settings scoped to user or tenant.
//   - `layerSettingsStub` — Layer that fails every method with the tagged error.
//   - Tagged error: `SettingsNotImplementedError`.
//   - Types: `SettingsScope`, `SettingsShape`.
//
// Real implementation deferred to Phase 7 (Bob migration). Real impl will be
// DB-backed (drizzle on a `user_settings` / `tenant_settings` table).
import { Effect, Layer, Schema, ServiceMap } from "effect";

import type { TenantId, UserId } from "@gmacko/core/validators";

export type SettingsScope = "user" | "tenant";

export class SettingsNotImplementedError extends Schema.TaggedErrorClass<SettingsNotImplementedError>()(
  "SettingsNotImplementedError",
  {
    reason: Schema.String,
    scope: Schema.optional(Schema.String),
    key: Schema.optional(Schema.String),
  },
) {}

export interface SettingsShape {
  readonly getForUser: (
    userId: UserId,
    key: string,
  ) => Effect.Effect<unknown, SettingsNotImplementedError>;
  readonly getForTenant: (
    tenantId: TenantId,
    key: string,
  ) => Effect.Effect<unknown, SettingsNotImplementedError>;
  readonly updateForUser: (
    userId: UserId,
    key: string,
    value: unknown,
  ) => Effect.Effect<void, SettingsNotImplementedError>;
  readonly updateForTenant: (
    tenantId: TenantId,
    key: string,
    value: unknown,
  ) => Effect.Effect<void, SettingsNotImplementedError>;
}

export const Settings = ServiceMap.Service<SettingsShape>(
  "@gmacko/settings/Settings",
);

const reason = "@gmacko/settings: deferred to Phase 7 (Bob migration)";

export const layerSettingsStub: Layer.Layer<SettingsShape> = Layer.succeed(
  Settings,
  {
    getForUser: (_uid, key) =>
      Effect.fail(
        new SettingsNotImplementedError({ reason, scope: "user", key }),
      ),
    getForTenant: (_tid, key) =>
      Effect.fail(
        new SettingsNotImplementedError({ reason, scope: "tenant", key }),
      ),
    updateForUser: (_uid, key) =>
      Effect.fail(
        new SettingsNotImplementedError({ reason, scope: "user", key }),
      ),
    updateForTenant: (_tid, key) =>
      Effect.fail(
        new SettingsNotImplementedError({ reason, scope: "tenant", key }),
      ),
  },
);

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoSettingsPhase = "6l" as const;
