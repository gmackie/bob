// SecretsRpc — wire contract for tenant-scoped encrypted-secret management.
//
// Mirrors `@gmacko/secrets::SecretsShape` (minus `tenantId` payload fields —
// tenant scope comes from `CurrentUser` at the handler layer, per the 6F
// design decision). `secrets.create` accepts `plaintext` on the wire so
// callers can issue a new secret; the envelope returned never re-exposes it.
// `secrets.decryptForUse` is the ONLY path that returns plaintext, and only
// after the server-side policy + usage-counter checks run.
//
// 7B-4B Task 10: `secrets.session.*` sub-namespace — 8 procedures ported from
// Bob's `secretsRouter` for session-scoped secrets (create, list, manifest,
// getForExecution, delete, markUsed, upsertDeployBinding, promote).
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  MaxUsesExceededError,
  PolicyDeniedError,
  SecretNameConflictError,
  SecretNotFoundError,
} from "@gmacko/core/secrets/errors";
import { NotFoundError } from "@gmacko/core/rpc/errors";

import {
  SecretEnvelopeSchema,
  SessionSecretPolicySchema,
} from "../schemas/secrets.js";
import {
  DeployEnvironmentEnum,
  ProjectDeployBindingSchema,
  SecretTransportEnum,
  SessionSecretDeleteResultSchema,
  SessionSecretForExecutionSchema,
  SessionSecretManifestSchema,
  SessionSecretPolicyInputSchema,
  SessionSecretSchema,
  SessionSecretUsageSchema,
} from "../schemas/secrets-session.js";

// --- Procedure descriptors (tenant-scoped) ---

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

// --- Procedure descriptors (secrets.session.*) — 7B-4B Task 10 ---

/** Retrieve the manifest (all secrets) for a session. Auth: apiKeyWrite. */
export const SecretsSessionGetManifestRpc = Rpc.make(
  "secrets.session.getManifest",
  {
    payload: Schema.Struct({
      sessionId: Schema.String.check(Schema.isUUID()),
    }),
    success: SessionSecretManifestSchema,
    error: NotFoundError,
  },
);

/** Get a single session secret by handle for execution. Auth: apiKeyWrite. */
export const SecretsSessionGetForExecutionRpc = Rpc.make(
  "secrets.session.getForExecution",
  {
    payload: Schema.Struct({
      sessionId: Schema.String.check(Schema.isUUID()),
      handle: Schema.String,
    }),
    success: SessionSecretForExecutionSchema,
    error: NotFoundError,
  },
);

/** Create a session-scoped secret. Auth: protected. */
export const SecretsSessionCreateRpc = Rpc.make("secrets.session.create", {
  payload: Schema.Struct({
    sessionId: Schema.String.check(Schema.isUUID()),
    label: Schema.String,
    handle: Schema.String,
    value: Schema.String,
    transport: Schema.optional(SecretTransportEnum),
    policy: Schema.optional(SessionSecretPolicyInputSchema),
  }),
  success: SessionSecretSchema,
});

/** List all secrets for a session. Auth: protected. */
export const SecretsSessionListRpc = Rpc.make("secrets.session.list", {
  payload: Schema.Struct({
    sessionId: Schema.String.check(Schema.isUUID()),
  }),
  success: SessionSecretManifestSchema,
  error: NotFoundError,
});

/** Delete a session secret. Auth: protected. */
export const SecretsSessionDeleteRpc = Rpc.make("secrets.session.delete", {
  payload: Schema.Struct({
    secretId: Schema.String,
  }),
  success: SessionSecretDeleteResultSchema,
  error: SecretNotFoundError,
});

/** Record usage of a session secret. Auth: protected. */
export const SecretsSessionMarkUsedRpc = Rpc.make(
  "secrets.session.markUsed",
  {
    payload: Schema.Struct({
      secretId: Schema.String,
      sessionId: Schema.String.check(Schema.isUUID()),
      executor: Schema.String,
      templateId: Schema.optional(Schema.String),
      commandPreview: Schema.optional(Schema.String),
      exitCode: Schema.optional(Schema.Number),
      durationMs: Schema.optional(Schema.Number),
    }),
    success: SessionSecretUsageSchema,
  },
);

/** Upsert a project deploy secret binding. Auth: protected. */
export const SecretsSessionUpsertDeployBindingRpc = Rpc.make(
  "secrets.session.upsertDeployBinding",
  {
    payload: Schema.Struct({
      projectId: Schema.String.check(Schema.isUUID()),
      environment: DeployEnvironmentEnum,
      label: Schema.String,
      forgegraphKey: Schema.String,
      externalRef: Schema.String,
      transport: Schema.optional(SecretTransportEnum),
      templateId: Schema.optional(Schema.String),
    }),
    success: ProjectDeployBindingSchema,
    error: NotFoundError,
  },
);

/** Promote a session secret to a deploy binding. Auth: protected. */
export const SecretsSessionPromoteRpc = Rpc.make("secrets.session.promote", {
  payload: Schema.Struct({
    secretId: Schema.String,
    projectId: Schema.String.check(Schema.isUUID()),
    environment: DeployEnvironmentEnum,
    forgegraphKey: Schema.String,
  }),
  success: SessionSecretSchema,
  error: Schema.Union([SecretNotFoundError, NotFoundError]),
});

// --- Group ---

export const SecretsRpc = RpcGroup.make(
  // Tenant-scoped (original 6)
  SecretsCreateRpc,
  SecretsListRpc,
  SecretsGetEnvelopeRpc,
  SecretsDecryptForUseRpc,
  SecretsMarkUsedRpc,
  SecretsDeleteRpc,
  // Session-scoped (7B-4B Task 10)
  SecretsSessionGetManifestRpc,
  SecretsSessionGetForExecutionRpc,
  SecretsSessionCreateRpc,
  SecretsSessionListRpc,
  SecretsSessionDeleteRpc,
  SecretsSessionMarkUsedRpc,
  SecretsSessionUpsertDeployBindingRpc,
  SecretsSessionPromoteRpc,
);
