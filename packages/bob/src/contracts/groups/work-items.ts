// WorkItemsRpc — wire contract for Bob work-item core + comment operations.
// 7B-4C Task 1: 6 procedures covering CRUD, promote-to-task, and comments.
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { BobNotFoundError, BobForbiddenError } from "../errors.js";
import {
  WorkItemKindEnum,
  WorkItemRecordSchema,
  CommentRecordSchema,
  GetWorkItemResultSchema,
} from "../schemas/work-item-core.js";

export const WorkItemListRpc = Rpc.make("workItem.list", {
  payload: Schema.Struct({
    workspaceId: Schema.String,
    projectId: Schema.optional(Schema.String),
    parentId: Schema.optional(Schema.NullOr(Schema.String)),
    kind: Schema.optional(WorkItemKindEnum),
    status: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(WorkItemRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemGetRpc = Rpc.make("workItem.get", {
  payload: Schema.Struct({ id: Schema.String }),
  success: GetWorkItemResultSchema,
  error: BobNotFoundError,
});

export const WorkItemUpdateRpc = Rpc.make("workItem.update", {
  payload: Schema.Struct({
    id: Schema.String,
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.NullOr(Schema.String)),
    status: Schema.optional(Schema.String),
  }),
  success: Schema.NullOr(WorkItemRecordSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const WorkItemPromoteToTaskRpc = Rpc.make("workItem.promoteToTask", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.NullOr(WorkItemRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemCommentListRpc = Rpc.make("workItem.comment.list", {
  payload: Schema.Struct({ workItemId: Schema.String }),
  success: Schema.Array(CommentRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemCommentCreateRpc = Rpc.make("workItem.comment.create", {
  payload: Schema.Struct({
    workItemId: Schema.String,
    body: Schema.String,
    bodyHtml: Schema.optional(Schema.String),
    parentId: Schema.optional(Schema.String),
  }),
  success: CommentRecordSchema,
  error: BobNotFoundError,
});

export const WorkItemsRpc = RpcGroup.make(
  WorkItemListRpc,
  WorkItemGetRpc,
  WorkItemUpdateRpc,
  WorkItemPromoteToTaskRpc,
  WorkItemCommentListRpc,
  WorkItemCommentCreateRpc,
);
