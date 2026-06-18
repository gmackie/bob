// Deterministic stub handlers for the Auth RPC contract group.
//
// Why deterministic: OODA writes golden-style tests against these stubs; any
// randomness (UUIDs, timestamps) would make those tests flaky. All IDs and
// timestamps are fixed.
//
// Handler attachment API: `AuthRpc.toLayer({ ... })` — this is the API
// verified in `RpcGroup.d.ts:50`. `.of({...})` is a type-identity pass-through
// for handler maps (useful for extracting a handler map without also building
// a Layer); `.toLayer(...)` is what we want because we hand this to
// `Effect.provide` or `RpcServer.layerHttp({ handlers: ... })`.
//
// Exhaustiveness enforcement: `RpcGroup.toLayer`'s `HandlersFrom<R>` type is
// a mapped object over every tag in the group. Missing a tag = type error at
// compile time. Extra tags = type error. We rely on that for safety rather
// than runtime assertions.
import { DateTime, Effect } from "effect";

import { InvalidApiKeyError, InvalidDeviceCodeError } from "@gmacko/core/auth/errors";

import { AuthRpc } from "../groups/auth.js";

// --- Deterministic mock data ---------------------------------------------

const STUB_USER_ID = "user_stub_abc";
const STUB_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const STUB_EMAIL = "stub@example.com";
const STUB_API_KEY_ID = "00000000-0000-0000-0000-0000000000aa";
const STUB_API_KEY_PREFIX = "gmk_stub";
const STUB_API_KEY_PLAINTEXT = "gmk_stub_plaintext_value_for_tests_only";
const STUB_DEVICE_CODE = "stub_device_code_abc";
const STUB_USER_CODE = "WXYZ-1234";
const STUB_VERIFICATION_URI = "https://stub.example/device";

// Fixed timestamp so golden tests are stable. `DateTime.makeUnsafe` (verified
// at `effect/dist/DateTime.d.ts:441` — NOT `unsafeMake`, which is a common
// drift mistake) accepts ISO-8601 strings and yields `Utc`.
const STUB_CREATED_AT = DateTime.makeUnsafe("2026-04-19T00:00:00.000Z");
const STUB_EXPIRES_AT = DateTime.makeUnsafe("2026-04-20T00:00:00.000Z");

// --- Handlers -------------------------------------------------------------

export const stubAuthHandlers = AuthRpc.toLayer({
  "auth.whoAmI": () =>
    Effect.succeed({
      userId: STUB_USER_ID,
      tenantId: STUB_TENANT_ID,
      email: STUB_EMAIL,
      role: "owner" as const,
    }),

  "auth.listMemberships": () =>
    Effect.succeed([
      { tenantId: STUB_TENANT_ID, role: "owner" as const },
    ]),

  "auth.resolveTenant": () =>
    // Happy-path stub: always succeeds with the sole stub membership. The
    // error-channel contract is declared on the Rpc itself; a real handler
    // will surface `TenantNotSelectedError` when a caller has 2+ memberships
    // without a hint. OODA tests the error path via their own handler
    // replacement, not via this stub.
    Effect.succeed({ tenantId: STUB_TENANT_ID, role: "owner" as const }),

  "auth.issueApiKey": () =>
    Effect.succeed({
      id: STUB_API_KEY_ID,
      plaintext: STUB_API_KEY_PLAINTEXT,
      keyPrefix: STUB_API_KEY_PREFIX,
    }),

  "auth.listApiKeys": () =>
    Effect.succeed([
      {
        id: STUB_API_KEY_ID,
        name: "Stub API key",
        keyPrefix: STUB_API_KEY_PREFIX,
        permissions: ["read", "write"] as const,
        createdAt: STUB_CREATED_AT,
        revokedAt: null,
        lastUsedAt: null,
        expiresAt: null,
      },
    ]),

  "auth.revokeApiKey": ({ apiKeyId }) =>
    apiKeyId === STUB_API_KEY_ID
      ? Effect.void
      : Effect.fail(
          new InvalidApiKeyError({
            message: `stub: unknown API key id '${apiKeyId}'`,
          }),
        ),

  "auth.startDeviceFlow": () =>
    Effect.succeed({
      deviceCode: STUB_DEVICE_CODE,
      userCode: STUB_USER_CODE,
      verificationUri: STUB_VERIFICATION_URI,
      expiresAt: STUB_EXPIRES_AT,
    }),

  "auth.pollDeviceCode": ({ deviceCode }) =>
    deviceCode === STUB_DEVICE_CODE
      ? Effect.succeed({ status: "pending" as const })
      : Effect.fail(
          new InvalidDeviceCodeError({
            message: `stub: unknown device code '${deviceCode}'`,
          }),
        ),

  "auth.approveDeviceCode": () =>
    // Stub always succeeds; error-path replacement lives in real handler.
    Effect.void,

  // 7B-4B Task 11 — Bob auth
  "auth.getSession": () =>
    Effect.succeed({
      user: {
        id: STUB_USER_ID,
        email: STUB_EMAIL,
        name: "Stub User",
      },
      session: {
        id: "session_stub_001",
        userId: STUB_USER_ID,
      },
    }),

  "auth.getSecretMessage": () =>
    Effect.succeed("you can see this secret message!"),
});
