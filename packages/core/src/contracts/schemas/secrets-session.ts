// Wire schemas for the secrets.session.* RPC sub-namespace. Models
// session-scoped secrets (created per-chat, promotable to deploy bindings)
// as defined in Bob's `SessionSecretService`.
import { Schema } from "effect";

import { SessionSecretPolicySchema } from "./secrets.js";

// --- Enums ------------------------------------------------------------------

/** Transport mechanism for injecting a secret into an execution context. */
export const SecretTransportEnum = Schema.Literals([
  "template",
  "http",
  "stdin",
  "file",
]);
export type SecretTransport = typeof SecretTransportEnum.Type;

/** Deployment target environment. */
export const DeployEnvironmentEnum = Schema.Literals([
  "dev",
  "staging",
  "prod",
  "preview",
]);
export type DeployEnvironment = typeof DeployEnvironmentEnum.Type;

// --- Domain schemas ---------------------------------------------------------

/**
 * Public (no-plaintext) view of a session-scoped secret.
 * Mirrors `SessionSecretService.toPublicSecret()` output shape.
 */
export const SessionSecretSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String.check(Schema.isUUID()),
  label: Schema.String,
  handle: Schema.String,
  transport: SecretTransportEnum,
  status: Schema.Literals(["active", "promoted", "revoked"]),
  provider: Schema.Literals(["bob", "forgegraph"]),
  policy: SessionSecretPolicySchema,
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
  workspaceId: Schema.optional(Schema.NullOr(Schema.String)),
  externalRef: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.Date),
  updatedAt: Schema.optional(Schema.Date),
});
export type SessionSecretWire = typeof SessionSecretSchema.Type;

/**
 * Manifest entry — the same as `SessionSecretSchema` but returned as an
 * array by `getManifest` and `list`. We reuse the schema; the distinction
 * is purely semantic (manifest = all secrets for a session).
 */
export const SessionSecretManifestSchema = Schema.Array(SessionSecretSchema);
export type SessionSecretManifestWire = typeof SessionSecretManifestSchema.Type;

/**
 * Policy input for `secrets.session.create`. Matches the Zod
 * `secretPolicySchema` in Bob's router.
 */
export const SessionSecretPolicyInputSchema = Schema.Struct({
  allowedTemplates: Schema.optional(Schema.Array(Schema.String)),
  redactOutput: Schema.optional(Schema.Boolean),
  maxUses: Schema.optional(Schema.NullOr(Schema.Number)),
  templatePolicies: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        allowedArgPrefixes: Schema.optional(
          Schema.Record(Schema.String, Schema.Array(Schema.String)),
        ),
      }),
    ),
  ),
});
export type SessionSecretPolicyInputWire =
  typeof SessionSecretPolicyInputSchema.Type;

/**
 * Usage record written by `markSecretUsed`. Mirrors the row returned from
 * the `sessionSecretUsages` insert.
 */
export const SessionSecretUsageSchema = Schema.Struct({
  secretId: Schema.String,
  sessionId: Schema.String.check(Schema.isUUID()),
  executor: Schema.String,
  templateId: Schema.optional(Schema.String),
  commandPreview: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  durationMs: Schema.optional(Schema.Number),
});
export type SessionSecretUsageWire = typeof SessionSecretUsageSchema.Type;

/**
 * A project-level deploy secret binding.
 */
export const ProjectDeployBindingSchema = Schema.Struct({
  projectId: Schema.String.check(Schema.isUUID()),
  environment: DeployEnvironmentEnum,
  label: Schema.String,
  forgegraphKey: Schema.String,
  externalRef: Schema.String,
  transport: SecretTransportEnum,
  templateId: Schema.optional(Schema.String),
});
export type ProjectDeployBindingWire = typeof ProjectDeployBindingSchema.Type;

/**
 * Result from `secrets.session.getForExecution` — the public secret plus
 * its decrypted value and usage count.
 */
export const SessionSecretForExecutionSchema = Schema.Struct({
  ...SessionSecretSchema.fields,
  usageCount: Schema.Number,
  value: Schema.String,
});
export type SessionSecretForExecutionWire =
  typeof SessionSecretForExecutionSchema.Type;

/** Result from `secrets.session.delete`. */
export const SessionSecretDeleteResultSchema = Schema.Struct({
  deleted: Schema.Number,
});
export type SessionSecretDeleteResultWire =
  typeof SessionSecretDeleteResultSchema.Type;
