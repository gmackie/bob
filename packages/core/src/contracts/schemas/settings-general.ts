// Wire-format schemas for settings general procedures.
//
// Covers user preferences, API keys (settings-scoped, separate from auth
// API keys), config root browsing, and ForgeGraph connection status.
import { Schema } from "effect";

import { WireTimestamp } from "./wire-timestamp.js";

// --- Enums ------------------------------------------------------------------

export const ThemeEnum = Schema.Literals(["light", "dark", "system"]);
export type Theme = typeof ThemeEnum.Type;

export const ConfigRootIdEnum = Schema.Literals([
  "opencode_xdg",
  "opencode_dot",
  "claude_dot",
  "codex_dot",
  "gemini_dot",
  "kiro_dot",
  "cursor_agent_dot",
]);
export type ConfigRootId = typeof ConfigRootIdEnum.Type;

// --- User preferences -------------------------------------------------------

export const UserPreferencesSchema = Schema.Struct({
  userId: Schema.String,
  theme: Schema.optional(ThemeEnum),
  defaultModel: Schema.optional(Schema.NullOr(Schema.String)),
  editorFontSize: Schema.optional(Schema.NullOr(Schema.Number)),
  enableNotifications: Schema.optional(Schema.Boolean),
  emailNotifications: Schema.optional(Schema.Boolean),
  pushNotifications: Schema.optional(Schema.Boolean),
  timezone: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(WireTimestamp),
  updatedAt: Schema.optional(WireTimestamp),
});
export type UserPreferencesWire = typeof UserPreferencesSchema.Type;

// --- Settings API keys (distinct from auth API keys) -------------------------

export const SettingsApiKeySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  keyPrefix: Schema.String,
  // `api_keys.permissions` is an unconstrained JSON column and production
  // holds scopes beyond this set (e.g. "daemon") plus a legacy
  // `{"scopes":[...]}` shape. A literal union here made every real listing
  // fail to encode; the handler normalises, this stays honest about the column.
  permissions: Schema.Array(Schema.String),
  lastUsedAt: Schema.NullOr(WireTimestamp),
  expiresAt: Schema.NullOr(WireTimestamp),
  createdAt: WireTimestamp,
});
export type SettingsApiKeyWire = typeof SettingsApiKeySchema.Type;

// --- Config root / entries / file content ------------------------------------

export const ConfigRootSchema = Schema.Struct({
  id: ConfigRootIdEnum,
  label: Schema.String,
  dir: Schema.String,
  exists: Schema.Boolean,
});
export type ConfigRootWire = typeof ConfigRootSchema.Type;

export const ConfigEntrySchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  isDir: Schema.Boolean,
  size: Schema.NullOr(Schema.Number),
  mtimeMs: Schema.Number,
});
export type ConfigEntryWire = typeof ConfigEntrySchema.Type;

export const ConfigFileSchema = Schema.Struct({
  rootDir: Schema.String,
  path: Schema.String,
  size: Schema.Number,
  mtimeMs: Schema.Number,
  content: Schema.optional(Schema.String),
});
export type ConfigFileWire = typeof ConfigFileSchema.Type;

// --- ForgeGraph connection ---------------------------------------------------

export const ForgeGraphConnectionSchema = Schema.Struct({
  id: Schema.String,
  providerUsername: Schema.NullOr(Schema.String),
  createdAt: Schema.optional(WireTimestamp),
});
export type ForgeGraphConnectionWire = typeof ForgeGraphConnectionSchema.Type;
