// Wire schemas for GitProvider connections — supporting the
// projects.gitProvider RPCs added in Phase 7B-4B Task 8.
//
// Translated from Bob's Zod schemas in:
//   - packages/bob/src/api/src/router/gitProviders.ts
//
// Enum values are the contract-level superset of Bob's DB enums.
// UUID fields use plain `Schema.String` on the wire (matching
// auth/projects/agent-instance convention).
import { Schema } from "effect";

// --- Enums ------------------------------------------------------------------

/** Supported git hosting providers. */
export const GitProviderEnum = Schema.Literal("github", "gitlab", "gitea");
export type GitProvider = Schema.Schema.Type<typeof GitProviderEnum>;

// --- Record schemas ---------------------------------------------------------

/** A git provider connection record. */
export const GitProviderConnectionSchema = Schema.Struct({
  id: Schema.String, // UUID
  provider: GitProviderEnum,
  instanceUrl: Schema.NullOr(Schema.String),
  providerAccountId: Schema.String,
  providerUsername: Schema.String,
});
export type GitProviderConnectionWire = Schema.Schema.Type<
  typeof GitProviderConnectionSchema
>;

/** Result of testing a git provider connection. */
export const ConnectionTestResultSchema = Schema.Struct({
  valid: Schema.Boolean,
  error: Schema.optional(Schema.String),
  user: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      username: Schema.String,
      name: Schema.NullOr(Schema.String),
      avatarUrl: Schema.NullOr(Schema.String),
    }),
  ),
});
export type ConnectionTestResultWire = Schema.Schema.Type<
  typeof ConnectionTestResultSchema
>;

/** Result of detecting a remote URL for a repository. */
export const RemoteDetectionResultSchema = Schema.Struct({
  detected: Schema.Boolean,
  remoteUrl: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.NullOr(GitProviderEnum)),
  instanceUrl: Schema.optional(Schema.NullOr(Schema.String)),
  owner: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
});
export type RemoteDetectionResultWire = Schema.Schema.Type<
  typeof RemoteDetectionResultSchema
>;
