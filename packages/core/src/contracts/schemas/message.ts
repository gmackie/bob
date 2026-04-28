import { Schema } from "effect";

export const MessageRole = Schema.Literals(["user", "assistant", "system"]);

export const Message = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  threadId: Schema.String.check(Schema.isUUID()),
  branchId: Schema.String.check(Schema.isUUID()),
  parentId: Schema.NullOr(Schema.String.check(Schema.isUUID())),
  role: MessageRole,
  content: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.withDecodingDefault(() => ({}))),
  createdAt: Schema.Date,
});
export type Message = typeof Message.Type;

export const CreateMessageInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isUUID()),
  branchId: Schema.String.check(Schema.isUUID()),
  parentId: Schema.NullOr(Schema.String.check(Schema.isUUID())),
  role: MessageRole,
  content: Schema.String.check(Schema.isMinLength(1)),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.withDecodingDefault(() => ({}))),
});

export const ChatInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isUUID()),
  branchId: Schema.String.check(Schema.isUUID()),
  content: Schema.String.check(Schema.isMinLength(1)),
});
