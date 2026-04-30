// Schema definitions for agent.post.* RPCs (7B-4B Task 4).
//
// Maps to Bob's demo Post CRUD router. Minimal schema — the Post table
// is a simple id/title/content/createdAt record used for template demos.

import { Schema } from "effect";

export const PostSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  content: Schema.String,
  createdAt: Schema.Date,
});
export type PostWire = Schema.Schema.Type<typeof PostSchema>;
