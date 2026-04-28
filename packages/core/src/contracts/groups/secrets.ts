// SecretsRpc — wire contract for tenant-scoped encrypted-secret management.
//
// Mirrors `@gmacko/secrets::SecretsShape` (minus `tenantId` payload fields —
// tenant scope comes from `CurrentUser` at the handler layer, per the 6F
// design decision). `secrets.create` accepts `plaintext` on the wire so
// callers can issue a new secret; the envelope returned never re-exposes it.
// `secrets.decryptForUse` is the ONLY path that returns plaintext, and only
// after the server-side policy + usage-counter checks run.
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  MaxUsesExceededError,
  PolicyDeniedError,
  SecretNameConflictError,
  SecretNotFoundError,
} from "@gmacko/core/secrets/errors";

import {
  SecretEnvelopeSchema,
  SessionSecretPolicySchema,
} from "../schemas/secrets.js";

// --- Procedure descriptors ---

export const SecretsCreateRpc = Rpc.make("secrets.create", {
  payload: Schema.Struct({
    name: Schema.String,
    plaintext: Schema.String,
    policy: Schema.optional(SessionSecretPolicySchema),
    usesRemaining: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
  success: SecretEnvelopeSchema,
  error: SecretNameConflictError,
});

export const SecretsListRpc = Rpc.make("secrets.list", {
  payload: Schema.Void,
  success: Schema.Array(SecretEnvelopeSchema),
});

export const SecretsGetEnvelopeRpc = Rpc.make("secrets.getEnvelope", {
  payload: Schema.Struct({
    secretId: Schema.String.check(Schema.isUUID()),
  }),
  success: SecretEnvelopeSchema,
  error: SecretNotFoundError,
});

export const SecretsDecryptForUseRpc = Rpc.make("secrets.decryptForUse", {
  payload: Schema.Struct({
    secretId: Schema.String.check(Schema.isUUID()),
    templateId: Schema.optional(Schema.String),
    args: Schema.optional(Schema.Array(Schema.String)),
  }),
  success: Schema.Struct({
    plaintext: Schema.String,
    envelope: SecretEnvelopeSchema,
  }),
  // Array-arg Schema.Union works in the Rpc.make error slot (verified against
  // effect@4.0.0-beta.43 Rpc.d.ts:290 — `error: Error extends Schema.Top`).
  error: Schema.Union([
    SecretNotFoundError,
    PolicyDeniedError,
    MaxUsesExceededError,
  ]),
});

export const SecretsMarkUsedRpc = Rpc.make("secrets.markUsed", {
  payload: Schema.Struct({
    secretId: Schema.String.check(Schema.isUUID()),
    templateId: Schema.optional(Schema.String),
    commandPrefix: Schema.optional(Schema.String),
    success: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Void,
  error: SecretNotFoundError,
});

export const SecretsDeleteRpc = Rpc.make("secrets.delete", {
  payload: Schema.Struct({
    secretId: Schema.String.check(Schema.isUUID()),
  }),
  success: Schema.Void,
  error: SecretNotFoundError,
});

// --- Group ---

export const SecretsRpc = RpcGroup.make(
  SecretsCreateRpc,
  SecretsListRpc,
  SecretsGetEnvelopeRpc,
  SecretsDecryptForUseRpc,
  SecretsMarkUsedRpc,
  SecretsDeleteRpc,
);
