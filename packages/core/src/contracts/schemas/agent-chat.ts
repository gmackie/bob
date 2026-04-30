// Schema definitions for agent.chat.* RPCs (7B-4B Task 4).
//
// ChatConversationSchema and ChatMessageSchema already exist in
// schemas/agent.ts — this file only adds the ChatAttachmentSchema
// needed by agent.chat.attachImage / getAttachments.

import { Schema } from "effect";

export const ChatAttachmentSchema = Schema.Struct({
  id: Schema.String,
  messageId: Schema.String,
  type: Schema.String, // e.g. "image"
  url: Schema.String,
  filename: Schema.NullOr(Schema.String),
  mimeType: Schema.NullOr(Schema.String),
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  sizeBytes: Schema.NullOr(Schema.Number),
  createdAt: Schema.Date,
});
export type ChatAttachmentWire = Schema.Schema.Type<
  typeof ChatAttachmentSchema
>;
