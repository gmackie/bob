import { Schema } from "effect";

import { WireTimestamp } from "./wire-timestamp.js";

export const Branch = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  threadId: Schema.String.check(Schema.isUUID()),
  parentBranchId: Schema.NullOr(Schema.String.check(Schema.isUUID())),
  forkPointMessageId: Schema.NullOr(Schema.String.check(Schema.isUUID())),
  name: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
  createdAt: WireTimestamp,
});
export type Branch = typeof Branch.Type;

export const CreateBranchInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isUUID()),
  parentBranchId: Schema.String.check(Schema.isUUID()),
  forkPointMessageId: Schema.String.check(Schema.isUUID()),
  name: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
});

export const SetActiveBranchInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isUUID()),
  branchId: Schema.String.check(Schema.isUUID()),
});
