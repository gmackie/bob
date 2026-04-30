// Schema definitions for agent.filesystem.* RPCs (7B-4B Task 4).
//
// These are simple payload/result schemas for filesystem operations.
// All handlers will initially throw NOT_IMPLEMENTED — the Go daemon
// owns file access and these contracts exist for future proxying.

import { Schema } from "effect";

// --- Filesystem entry (returned by list) ------------------------------------

export const FileEntrySchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  isDirectory: Schema.Boolean,
  size: Schema.optional(Schema.Number),
  modifiedAt: Schema.optional(Schema.String),
});
export type FileEntryWire = Schema.Schema.Type<typeof FileEntrySchema>;

// --- Git status entry -------------------------------------------------------

export const GitStatusEntrySchema = Schema.Struct({
  path: Schema.String,
  status: Schema.String, // e.g. "modified", "added", "deleted", "untracked"
});
export type GitStatusEntryWire = Schema.Schema.Type<typeof GitStatusEntrySchema>;

// --- Search result ----------------------------------------------------------

export const FileSearchResultSchema = Schema.Struct({
  path: Schema.String,
  matches: Schema.Array(
    Schema.Struct({
      line: Schema.Number,
      content: Schema.String,
    }),
  ),
});
export type FileSearchResultWire = Schema.Schema.Type<
  typeof FileSearchResultSchema
>;
