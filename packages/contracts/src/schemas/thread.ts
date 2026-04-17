import { Schema } from "effect";

export const ThreadStatus = Schema.Literals(["active", "paused", "archived", "completed"]);
export type ThreadStatus = typeof ThreadStatus.Type;

export const Thread = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  title: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
  status: ThreadStatus,
  activeBranchId: Schema.NullOr(Schema.String.check(Schema.isUUID())),
  tags: Schema.Array(Schema.String),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type Thread = typeof Thread.Type;

export const CreateThreadInput = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
  tags: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});

export const UpdateThreadStatusInput = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  status: ThreadStatus,
});
