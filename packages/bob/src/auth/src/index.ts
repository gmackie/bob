// @bob/auth — Public barrel.
//
// Phase 7B-3 Task 4: `initAuth()` and the `Auth` type have been retired.
// Bob's auth now flows through the Effect auth runtime bridge
// (`createAuthRuntime` from `@bob/auth/runtime`).
//
// The only consumer that needed `initAuth` (apps/bob/src/auth/server.ts)
// now inlines the better-auth construction with `nextCookies()` directly.

// --- Context -----------------------------------------------------------------
export {
  resolveAuthContext,
  resolveAuthBypassUserId,
  resolveWorkspaceSelection,
  isDefaultUserFallbackEnabled,
  DEFAULT_USER_ID,
  type RequestAuthContext,
  type WorkspaceSelection,
} from "./context";

// --- API keys (Bob-specific, not retired) ------------------------------------
export {
  type ApiKeyAuth,
  type ApiKeyPermission,
  isApiKey,
  validateApiKey,
  hashApiKey,
  API_KEY_PREFIXES,
} from "./api-key";

// --- Effect auth runtime bridge ----------------------------------------------
export {
  createAuthRuntime,
  type AuthRuntimeBundle,
  type AuthRuntime,
  type AuthRuntimeOptions,
  type AuthServices,
  Sessions,
  ApiKeys,
  Tenancy,
  DeviceCodes,
} from "./runtime";
