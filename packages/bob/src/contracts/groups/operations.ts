import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import {
  BobConflictError,
  BobForbiddenError,
  BobNotFoundError,
} from "../errors.js";
import { CockpitStatusSchema } from "../schemas/cockpit.js";
import { ArtifactRecordSchema } from "../schemas/work-item-core.js";

const error = Schema.Union([
  BobConflictError,
  BobForbiddenError,
  BobNotFoundError,
]);
const uuid = Schema.String.check(Schema.isUUID());
const text = (min: number, max: number) =>
  Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max));
const integer = (minimum: number, maximum: number) =>
  Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum, maximum }));
const ok = Schema.Struct({ ok: Schema.Boolean });
const requestId = text(8, 64);
const Message = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  userId: Schema.String,
  clientMessageId: Schema.NullOr(Schema.String),
  body: Schema.String,
  createdAt: Schema.String,
  userName: Schema.NullOr(Schema.String),
  userImage: Schema.NullOr(Schema.String),
});
const Artifact = Schema.Struct({
  ...ArtifactRecordSchema.fields,
  contentVersion: Schema.Number,
  lastEditedByUserId: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
});

/** Bob operator controls and collaborative planning, shared by every app. */
export const OperationsRpc = RpcGroup.make(
  Rpc.make("cockpit.status", {
    payload: Schema.Struct({ includeOoda: Schema.optional(Schema.Boolean) }),
    success: CockpitStatusSchema,
    error,
  }),
  Rpc.make("cockpit.stopSession", {
    payload: Schema.Struct({ sessionId: uuid }),
    success: Schema.Struct({ id: Schema.String, status: Schema.String }),
    error,
  }),
  Rpc.make("cockpit.retryItem", {
    payload: Schema.Struct({ workItemId: uuid }),
    success: Schema.Struct({ status: Schema.String, attempts: Schema.Number }),
    error,
  }),
  Rpc.make("cockpit.bumpPriority", {
    payload: Schema.Struct({
      workItemId: uuid,
      priority: Schema.Literals([0, 1, 2, 3, 4]),
    }),
    success: Schema.Struct({ queueSortOrder: Schema.Number }),
    error,
  }),
  Rpc.make("cockpit.setDispatchEnabled", {
    payload: Schema.Struct({ enabled: Schema.Boolean }),
    success: Schema.Struct({ enabled: Schema.Boolean }),
    error,
  }),
  Rpc.make("cockpit.setBudget", {
    payload: Schema.Struct({
      dailyCap: Schema.optional(integer(1, 500)),
      concurrency: Schema.optional(integer(1, 16)),
    }),
    success: Schema.Record(Schema.String, Schema.Number),
    error,
  }),
  Rpc.make("cockpit.setAgentEnabled", {
    payload: Schema.Struct({ agent: Schema.String, enabled: Schema.Boolean }),
    success: Schema.Struct({ disabledAgents: Schema.Array(Schema.String) }),
    error,
  }),
  Rpc.make("cockpit.triggerReview", {
    payload: Schema.Struct({ pullRequestId: uuid }),
    success: Schema.Struct({
      dispatched: Schema.Boolean,
      sessionId: Schema.NullOr(Schema.String),
    }),
    error,
  }),
  Rpc.make("cockpit.reviewPr", {
    payload: Schema.Struct({
      pullRequestId: uuid,
      verdict: Schema.Literals(["APPROVE", "REQUEST_CHANGES"]),
      body: Schema.optional(text(0, 4000)),
    }),
    success: Schema.Struct({ posted: Schema.Boolean }),
    error,
  }),
  Rpc.make("agentAuth.start", {
    payload: Schema.Struct({
      workspaceId: uuid,
      provider: Schema.Literals(["claude", "codex", "grok", "cursor-agent"]),
      requestId,
    }),
    success: Schema.Struct({ ok: Schema.Boolean, requestId: Schema.String }),
    error,
  }),
  Rpc.make("agentAuth.submitCode", {
    payload: Schema.Struct({
      workspaceId: uuid,
      requestId,
      value: text(1, 512),
    }),
    success: ok,
    error,
  }),
  Rpc.make("agentAuth.cancel", {
    payload: Schema.Struct({ workspaceId: uuid, requestId }),
    success: ok,
    error,
  }),
  Rpc.make("dispatchControl.set", {
    payload: Schema.Struct({
      workspaceId: uuid,
      requestId,
      action: Schema.Literals(["start", "stop"]),
    }),
    success: Schema.Struct({ ok: Schema.Boolean, requestId: Schema.String }),
    error,
  }),
  Rpc.make("planning.session.listMessages", {
    payload: Schema.Struct({
      sessionId: uuid,
      limit: Schema.optional(integer(1, 200)),
    }),
    success: Schema.Array(Message),
    error,
  }),
  Rpc.make("planning.session.sendMessage", {
    payload: Schema.Struct({
      sessionId: uuid,
      body: text(1, 4000),
      clientMessageId: Schema.optional(text(0, 128)),
    }),
    success: Message,
    error,
  }),
  Rpc.make("planning.session.listArtifacts", {
    payload: Schema.Struct({ sessionId: uuid }),
    success: Schema.Array(Artifact),
    error,
  }),
  Rpc.make("planning.session.updateArtifact", {
    payload: Schema.Struct({
      artifactId: uuid,
      content: Schema.String,
      title: Schema.optional(text(1, 256)),
      expectedVersion: Schema.optional(
        Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
      ),
    }),
    success: Artifact,
    error,
  }),
  Rpc.make("planning.session.commitAsChecklist", {
    payload: Schema.Struct({
      sessionId: uuid,
      worktreeId: Schema.optional(uuid),
      title: Schema.optional(Schema.String),
      goal: Schema.optional(Schema.String),
    }),
    success: Schema.Struct({
      planId: Schema.NullOr(Schema.String),
      worktreeId: Schema.NullOr(Schema.String),
      items: Schema.Number,
    }),
    error,
  }),
  Rpc.make("planning.skill.stats", {
    payload: Schema.Void,
    success: Schema.Array(
      Schema.Struct({
        slug: Schema.String,
        name: Schema.String,
        count: Schema.Number,
        successCount: Schema.Number,
        totalDurationMs: Schema.Number,
      }),
    ),
    error,
  }),
  Rpc.make("external.forgegraph.importAllApps", {
    payload: Schema.Struct({ workspaceId: uuid }),
    success: Schema.Struct({
      imported: Schema.Number,
      projects: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          key: Schema.String,
        }),
      ),
    }),
    error,
  }),
);
