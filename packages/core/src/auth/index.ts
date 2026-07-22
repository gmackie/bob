// @gmacko/auth — better-auth wrapped as Effect services + tenancy RBAC.
//
// Public surface:
//   - `BetterAuth` / `initAuth` / `layerBetterAuth` — the underlying
//     better-auth instance as an Effect service.
//   - `Sessions`, `ApiKeys`, `DeviceCodes`, `Tenancy` — Effect services
//     that carry application-layer behavior on top of better-auth's schema
//     (session validation, tenant-scoped API keys, OAuth device flow,
//     memberships / RBAC / Option-B tenant resolution).
//   - `resolveCurrentUser` / `provideCurrentUser` — plain-function auth
//     middleware that populates `@gmacko/rpc`'s `CurrentUser` service for
//     an HTTP-like request.
//   - `layerAuth({ apiKeyIssuingPrefix?, userCodeTtlMs? })` — convenience
//     Layer that bundles `Sessions + ApiKeys + DeviceCodes + Tenancy` for
//     downstream consumers. Does NOT include `BetterAuth` itself — callers
//     construct that once at bootstrap with `initAuth` + `layerBetterAuth`.
//
// Client factories live on the `./client` subpath to keep react / expo
// dependencies out of server bundles.

import { Layer } from "effect";
import type { GmackoDb } from "@gmacko/core/db";

import { BetterAuth } from "./better-auth.js";
import { layerSessions, Sessions } from "./sessions.js";
import { layerApiKeys, ApiKeys, type LayerApiKeysOptions } from "./api-keys.js";
import {
  layerDeviceCodes,
  DeviceCodes,
  type LayerDeviceCodesOptions,
} from "./device-codes.js";
import { layerTenancy, Tenancy } from "./tenancy.js";

// Re-export the dependency-free tagged errors from `./errors`. Client
// bundles can also import these directly via `@gmacko/auth/errors` to avoid
// pulling in better-auth / drizzle / @gmacko/db. See
// docs/plans/2026-04-25-phase7a-punchlist.md Task 6.
export * from "./errors.js";

// Shared plain-async API-key validator (the single source of truth reused by
// both the Effect `ApiKeys` service and OODA's tRPC `authedProcedure`).
// Consumers in a Node request path SHOULD import from the lighter subpath
// `@gmacko/core/auth/validate-api-key` to avoid pulling in the full barrel.
export {
  API_KEY_PREFIXES,
  hashApiKey,
  isApiKeyLike,
  validateApiKey,
} from "./validate-api-key.js";
export type {
  ValidatedApiKey,
  ApiKeyRejectionReason,
  ApiKeyValidationResult,
} from "./validate-api-key.js";

export { BetterAuth, initAuth, layerBetterAuth } from "./better-auth.js";
export type { AuthInstance, InitAuthOptions } from "./better-auth.js";

export {
  Sessions,
  layerSessions,
  SessionExpiredError,
} from "./sessions.js";
export type { SessionValidationResult, SessionsShape } from "./sessions.js";

export {
  ApiKeys,
  layerApiKeys,
  InvalidApiKeyError,
} from "./api-keys.js";
export type {
  IssueKeyInput,
  IssuedKey,
  ValidatedKey,
  ApiKeyListItem,
  ApiKeysShape,
  LayerApiKeysOptions,
} from "./api-keys.js";

export {
  DeviceCodes,
  layerDeviceCodes,
  InvalidDeviceCodeError,
  InvalidUserCodeError,
  AlreadyApprovedError,
} from "./device-codes.js";
export type {
  StartResult,
  PollResult,
  DeviceCodesShape,
  LayerDeviceCodesOptions,
} from "./device-codes.js";

export {
  Tenancy,
  layerTenancy,
  NotAMemberError,
  InsufficientRoleError,
  TenantNotSelectedError,
} from "./tenancy.js";
export type { Membership, TenancyShape } from "./tenancy.js";

export {
  resolveCurrentUser,
  provideCurrentUser,
  DEFAULT_SESSION_COOKIE_NAME,
} from "./middleware.js";
export type { AuthRequest } from "./middleware.js";

export { AuthMiddleware, layerAuthMiddleware } from "./rpc-middleware.js";

export {
  RunnerSessions,
  layerRunnerSessions,
  InvalidRunnerSessionError,
} from "./runner-sessions.js";
export type {
  RunnerSessionClaims,
  RunnerSessionsShape,
  MintInput,
  MintResult,
} from "./runner-sessions.js";

export {
  RunnerSessionMiddleware,
  layerRunnerSessionMiddleware,
} from "./runner-session-middleware.js";

/**
 * Bundle of the four db-backed auth services. Callers provide `GmackoDb`
 * (via `@gmacko/db/service`) **and** `BetterAuth` (via `layerBetterAuth(...)`
 * with a pre-built `AuthInstance` from `initAuth(...)`) at app bootstrap;
 * the merged layer internally wires `ApiKeys` into `DeviceCodes` (device
 * flow mints an API key on completion).
 *
 * `BetterAuth` itself is **not** constructed here: the `AuthInstance`
 * requires per-environment secrets / OAuth creds and shouldn't be lazily
 * instantiated. It's listed in the requirements (R-channel) because
 * `Sessions.validateRequest` delegates to `auth.api.getSession` for the
 * cookie/signature path.
 */
export interface LayerAuthOptions {
  readonly apiKeys?: LayerApiKeysOptions;
  readonly deviceCodes?: LayerDeviceCodesOptions;
}

export const layerAuth = (
  opts: LayerAuthOptions = {},
): Layer.Layer<
  Sessions | ApiKeys | DeviceCodes | Tenancy,
  never,
  GmackoDb | BetterAuth
> => {
  const apiKeysLayer = layerApiKeys(opts.apiKeys);
  // DeviceCodes requires ApiKeys; provide it internally so callers only see
  // GmackoDb as the outstanding requirement.
  const deviceCodesLayer = Layer.provide(
    layerDeviceCodes(opts.deviceCodes),
    apiKeysLayer,
  );
  return Layer.mergeAll(
    layerSessions,
    apiKeysLayer,
    deviceCodesLayer,
    layerTenancy,
  );
};

/** Package version/phase sentinel — kept for the Task 8 smoke test. */
export const __gmackoAuthPhase = "6c" as const;
