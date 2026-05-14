import { Schema } from "effect";

export const PersonaSourceEnum = Schema.Literal("repo", "ui");
export type PersonaSource = Schema.Schema.Type<typeof PersonaSourceEnum>;

export const AutonomyLevelEnum = Schema.Literal(
  "observe",
  "recommend",
  "draft",
  "safe_execute",
  "full_execute",
);
export type AutonomyLevel = Schema.Schema.Type<typeof AutonomyLevelEnum>;

export const AgentPersonaSchema = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  description: Schema.NullOr(Schema.String),
  adapterId: Schema.String,
  model: Schema.NullOr(Schema.String),
  systemPrompt: Schema.NullOr(Schema.String),
  allowedTools: Schema.NullOr(Schema.Array(Schema.String)),
  autonomyLevel: Schema.NullOr(Schema.String),
  budgetLimitCents: Schema.NullOr(Schema.Number),
  source: PersonaSourceEnum,
  active: Schema.Boolean,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type AgentPersonaWire = Schema.Schema.Type<typeof AgentPersonaSchema>;

export const PersonaSyncResultSchema = Schema.Struct({
  created: Schema.Number,
  updated: Schema.Number,
  unchanged: Schema.Number,
});
export type PersonaSyncResultWire = Schema.Schema.Type<
  typeof PersonaSyncResultSchema
>;

export class PersonaNotFoundError extends Schema.TaggedErrorClass<PersonaNotFoundError>()(
  "PersonaNotFoundError",
  {
    personaId: Schema.String,
  },
) {}

export class PersonaReadOnlyError extends Schema.TaggedErrorClass<PersonaReadOnlyError>()(
  "PersonaReadOnlyError",
  {
    personaId: Schema.String,
  },
) {}
