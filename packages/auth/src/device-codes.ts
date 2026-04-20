// Effect service implementing the OAuth 2.0 Device Authorization Grant
// (RFC 8628) against the `device_codes` table.
//
// Flow:
//   1. Mobile/desktop client calls `start()` → receives a random device-code
//      (uuid, kept on-device) and a short, user-friendly `userCode`
//      (Crockford-base32, displayed to the human).
//   2. Human opens an approval URL on another device, authenticates, and
//      types in the `userCode` → the web app calls `approve({ userCode, ... })`
//      on their behalf.
//   3. Meanwhile the mobile/desktop client polls `poll(deviceCode)`. Once
//      the row is approved, the first polling call to WIN the claim race
//      gets a freshly-minted API key; subsequent polls see `consumed`.
//
// User-code alphabet: Crockford base32 — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
// Drops I / L / O / U to avoid visual confusion and "the bad word". Laid
// out as two groups of four characters joined by `-` (e.g. `K7B4-9XZM`).
//
// NOTE: not exported from the package barrel yet — Task 17 owns the public
// surface.
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Layer, Schema, ServiceMap } from "effect";

import { GmackoDb } from "@gmacko/db";
import { deviceCodes as deviceCodesTable } from "@gmacko/db/schema/device-codes";
import type { ApiKeyId, TenantId, UserId } from "@gmacko/validators";

import { ApiKeys } from "./api-keys.js";

export class InvalidDeviceCodeError extends Schema.TaggedErrorClass<InvalidDeviceCodeError>()(
  "InvalidDeviceCodeError",
  { message: Schema.String },
) {}

export class InvalidUserCodeError extends Schema.TaggedErrorClass<InvalidUserCodeError>()(
  "InvalidUserCodeError",
  { message: Schema.String },
) {}

export class AlreadyApprovedError extends Schema.TaggedErrorClass<AlreadyApprovedError>()(
  "AlreadyApprovedError",
  { message: Schema.String },
) {}

export interface StartResult {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresInSeconds: number;
}

export type PollResult =
  | { readonly status: "pending" }
  | { readonly status: "approved"; readonly plaintextApiKey: string }
  | { readonly status: "consumed" }
  | { readonly status: "denied" }
  | { readonly status: "expired" };

export interface DeviceCodesShape {
  readonly start: () => Effect.Effect<StartResult, never>;
  readonly approve: (input: {
    readonly userCode: string;
    readonly userId: UserId;
    readonly tenantId: TenantId;
  }) => Effect.Effect<
    { deviceCodeId: string },
    InvalidUserCodeError | AlreadyApprovedError
  >;
  readonly poll: (
    deviceCode: string,
  ) => Effect.Effect<PollResult, InvalidDeviceCodeError>;
}

export class DeviceCodes extends ServiceMap.Service<DeviceCodes, DeviceCodesShape>()(
  "@gmacko/auth/DeviceCodes",
) {}

export interface LayerDeviceCodesOptions {
  /** TTL in milliseconds. Default 10 minutes. */
  readonly ttlMs?: number;
  /** Name used for the minted API key when the flow completes. Default "Device flow". */
  readonly apiKeyName?: string;
}

// Crockford base32 alphabet: no I, L, O, U. 32 chars → 5 bits / char.
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Encode `randomBytes(5)` (40 bits) as 8 Crockford-base32 chars, then split
// as 4-`-`-4. Using bitwise math on a BigInt keeps the mapping deterministic
// even across bytes (we don't just do `byte % 32`, which would bias towards
// the first third of the alphabet).
const generateUserCode = (): string => {
  const bytes = randomBytes(5);
  let bits = 0n;
  for (const b of bytes) {
    bits = (bits << 8n) | BigInt(b);
  }
  let out = "";
  for (let i = 0; i < 8; i++) {
    const shift = BigInt(5 * (7 - i));
    const idx = Number((bits >> shift) & 0x1fn);
    out += CROCKFORD_ALPHABET[idx];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
};

export const layerDeviceCodes = (
  opts: LayerDeviceCodesOptions = {},
): Layer.Layer<DeviceCodes, never, GmackoDb | ApiKeys> =>
  Layer.effect(DeviceCodes)(
    Effect.gen(function* () {
      const db = yield* GmackoDb;
      const apiKeys = yield* ApiKeys;
      const ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
      const apiKeyName = opts.apiKeyName ?? "Device flow";

      const start: DeviceCodesShape["start"] = () =>
        Effect.gen(function* () {
          // Up to 5 retries on the unique index on user_code. In practice
          // with 40 bits of entropy the collision probability per attempt is
          // ~N/2^40 (birthday paradox), so this retry is mostly defensive.
          // If every attempt collides (statistically impossible on 40 bits)
          // we surface the most recent failure via `Effect.die`.
          let lastError: unknown = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            const userCode = generateUserCode();
            const expiresAt = new Date(Date.now() + ttlMs);
            const rows = yield* Effect.promise(async () =>
              db
                .insert(deviceCodesTable)
                .values({ userCode, expiresAt })
                .returning(),
            ).pipe(
              Effect.map((r) => ({ ok: true as const, rows: r })),
              Effect.catchCause((cause) =>
                Effect.succeed({ ok: false as const, cause }),
              ),
            );
            if (rows.ok) {
              const row = rows.rows[0]!;
              return {
                deviceCode: row.deviceCode,
                userCode: row.userCode,
                expiresInSeconds: Math.floor(ttlMs / 1000),
              };
            }
            lastError = rows.cause;
          }
          // 5 consecutive unique-constraint collisions is a structural defect,
          // not an expected error path; die so the fiber supervisor surfaces it.
          return yield* Effect.die(
            new Error(
              `device-code user-code generation failed after 5 attempts: ${String(lastError)}`,
            ),
          );
        });

      const approve: DeviceCodesShape["approve"] = ({
        userCode,
        userId,
        tenantId,
      }) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(async () =>
            db
              .select()
              .from(deviceCodesTable)
              .where(eq(deviceCodesTable.userCode, userCode))
              .limit(1),
          );
          const row = rows[0];
          if (!row) {
            return yield* Effect.fail(
              new InvalidUserCodeError({
                message: `Unknown user code: ${userCode}`,
              }),
            );
          }
          if (row.status === "approved") {
            return yield* Effect.fail(
              new AlreadyApprovedError({
                message: "Device code already approved",
              }),
            );
          }
          if (row.status !== "pending" || row.expiresAt <= new Date()) {
            return yield* Effect.fail(
              new InvalidUserCodeError({
                message: "Device code is not awaiting approval",
              }),
            );
          }
          yield* Effect.promise(async () =>
            db
              .update(deviceCodesTable)
              .set({ status: "approved", userId, tenantId })
              .where(eq(deviceCodesTable.id, row.id)),
          );
          return { deviceCodeId: row.id };
        });

      const poll: DeviceCodesShape["poll"] = (deviceCode) =>
        Effect.gen(function* () {
          const rows = yield* Effect.promise(async () =>
            db
              .select()
              .from(deviceCodesTable)
              .where(eq(deviceCodesTable.deviceCode, deviceCode))
              .limit(1),
          );
          const row = rows[0];
          if (!row) {
            return yield* Effect.fail(
              new InvalidDeviceCodeError({
                message: "Unknown device code",
              }),
            );
          }

          if (row.status === "denied") {
            return { status: "denied" as const };
          }
          if (row.status === "consumed") {
            return { status: "consumed" as const };
          }
          if (row.status === "expired") {
            return { status: "expired" as const };
          }

          if (row.status === "pending") {
            if (row.expiresAt <= new Date()) {
              // Best-effort flip to "expired" — only if it's still pending.
              // Guarded by status so a concurrent approval doesn't get
              // clobbered by this polling path.
              yield* Effect.promise(async () =>
                db
                  .update(deviceCodesTable)
                  .set({ status: "expired" })
                  .where(
                    and(
                      eq(deviceCodesTable.id, row.id),
                      eq(deviceCodesTable.status, "pending"),
                    ),
                  ),
              ).pipe(Effect.catchCause(() => Effect.void));
              return { status: "expired" as const };
            }
            return { status: "pending" as const };
          }

          // row.status === "approved" → the claim path. Mint a fresh API
          // key FIRST so we can atomically bind it to this device-code via
          // a conditional UPDATE; if the UPDATE touches 0 rows we lost the
          // race and must revoke the just-minted key to preserve the
          // invariant of one-unrevoked-key-per-device-code.
          if (!row.userId || !row.tenantId) {
            // Approved rows must always have userId + tenantId set by
            // `approve()`. If somehow not, treat as expired.
            return { status: "expired" as const };
          }
          const issued = yield* apiKeys.issueKey({
            userId: row.userId as UserId,
            tenantId: row.tenantId as TenantId,
            name: apiKeyName,
          });
          const claimed = yield* Effect.promise(async () =>
            db
              .update(deviceCodesTable)
              .set({ status: "consumed", apiKeyId: issued.id })
              .where(
                and(
                  eq(deviceCodesTable.id, row.id),
                  eq(deviceCodesTable.status, "approved"),
                ),
              )
              .returning(),
          );
          if (claimed.length === 0) {
            // Lost the race: another poller already claimed. Revoke the
            // key we just minted so we don't leak credentials.
            yield* apiKeys.revokeKey(issued.id as ApiKeyId);
            return { status: "consumed" as const };
          }
          return {
            status: "approved" as const,
            plaintextApiKey: issued.plaintext,
          };
        });

      return { start, approve, poll };
    }),
  );
