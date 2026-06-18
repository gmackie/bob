// Auth RPC contract group — authentication, tenancy, API keys, device flow.
//
// Design notes:
//   - Procedures do NOT declare `requires: [CurrentUser]` on themselves.
//     Requires-enforcement is the `AuthMiddleware`'s job (attached at
//     server-mount time via `RpcGroup.middleware(AuthMiddleware)`). The
//     plan locks this: only the middleware knows how to populate
//     `CurrentUser`; procedures just assume it's present in their handler
//     environment.
//   - Tagged errors flow through directly: `Schema.TaggedErrorClass`
//     instances ARE Schemas (per Task 2 drift notes), usable as the `error:`
//     field without wrapping.
//   - Where a procedure can fail with multiple tagged errors, we use
//     `Schema.Union([A, B])` — the same pattern proven in `rpc-middleware.ts`.
//   - `auth.revokeApiKey` reuses `InvalidApiKeyError` as the not-found shape
//     (the source package surfaces this error for both "unknown id" and
//     "wrong format"; we don't introduce a separate error class just for the
//     not-found case — fewer wire types = simpler consumer code).
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  AlreadyApprovedError,
  InvalidApiKeyError,
  InvalidDeviceCodeError,
  InvalidUserCodeError,
  TenantNotSelectedError,
} from "@gmacko/core/auth/errors";

import {
  ApiKeyIssueResultSchema,
  ApiKeyListItemSchema,
  CurrentUserSchema,
  DeviceCodePollResultSchema,
  DeviceFlowStartResultSchema,
  MembershipSchema,
} from "../schemas/auth.js";

// --- Identity / tenancy ---------------------------------------------------

export const AuthWhoAmIRpc = Rpc.make("auth.whoAmI", {
  payload: Schema.Void,
  success: CurrentUserSchema,
});

export const AuthListMembershipsRpc = Rpc.make("auth.listMemberships", {
  payload: Schema.Void,
  success: Schema.Array(MembershipSchema),
});

export const AuthResolveTenantRpc = Rpc.make("auth.resolveTenant", {
  payload: Schema.Struct({
    tenantIdHint: Schema.optional(Schema.String),
  }),
  success: MembershipSchema,
  error: TenantNotSelectedError,
});

// --- API keys -------------------------------------------------------------

export const AuthIssueApiKeyRpc = Rpc.make("auth.issueApiKey", {
  payload: Schema.Struct({
    name: Schema.String,
    permissions: Schema.Array(Schema.Literals(["read", "write", "admin"])),
    ttlMs: Schema.optional(Schema.Number),
  }),
  success: ApiKeyIssueResultSchema,
});

export const AuthListApiKeysRpc = Rpc.make("auth.listApiKeys", {
  payload: Schema.Void,
  success: Schema.Array(ApiKeyListItemSchema),
});

export const AuthRevokeApiKeyRpc = Rpc.make("auth.revokeApiKey", {
  payload: Schema.Struct({ apiKeyId: Schema.String }),
  success: Schema.Void,
  // Reused as the not-found shape — see file-level notes.
  error: InvalidApiKeyError,
});

// --- Device flow ----------------------------------------------------------

export const AuthStartDeviceFlowRpc = Rpc.make("auth.startDeviceFlow", {
  payload: Schema.Void,
  success: DeviceFlowStartResultSchema,
});

export const AuthPollDeviceCodeRpc = Rpc.make("auth.pollDeviceCode", {
  payload: Schema.Struct({ deviceCode: Schema.String }),
  success: DeviceCodePollResultSchema,
  error: InvalidDeviceCodeError,
});

export const AuthApproveDeviceCodeRpc = Rpc.make("auth.approveDeviceCode", {
  payload: Schema.Struct({
    userCode: Schema.String,
    tenantId: Schema.String,
  }),
  success: Schema.Void,
  // Two tagged errors: the user code could be unknown, or it could already
  // be approved. Same `Schema.Union([A, B])` pattern as AuthMiddleware's
  // error schema — verified to typecheck cleanly in Rpc.make's `error:` slot.
  error: Schema.Union([InvalidUserCodeError, AlreadyApprovedError]),
});

// --- Bob auth (7B-4B Task 11) --------------------------------------------

export const AuthGetSessionRpc = Rpc.make("auth.getSession", {
  payload: Schema.Void,
  success: Schema.NullOr(Schema.Unknown),
});

export const AuthGetSecretMessageRpc = Rpc.make("auth.getSecretMessage", {
  payload: Schema.Void,
  success: Schema.String,
});

// --- Group ----------------------------------------------------------------

export const AuthRpc = RpcGroup.make(
  AuthWhoAmIRpc,
  AuthListMembershipsRpc,
  AuthResolveTenantRpc,
  AuthIssueApiKeyRpc,
  AuthListApiKeysRpc,
  AuthRevokeApiKeyRpc,
  AuthStartDeviceFlowRpc,
  AuthPollDeviceCodeRpc,
  AuthApproveDeviceCodeRpc,
  // 7B-4B Task 11 — Bob auth
  AuthGetSessionRpc,
  AuthGetSecretMessageRpc,
);
