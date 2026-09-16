import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
const AutomationSettingsSchema = Schema.Struct({
  autoDispatch: Schema.optional(Schema.Boolean),
  autoBranch: Schema.optional(Schema.Boolean),
  autoFeaturePR: Schema.optional(Schema.Boolean),
  ciTrigger: Schema.optional(Schema.Boolean),
  reactFrontend: Schema.optional(Schema.Boolean),
  stageSkills: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Array(
        Schema.Struct({
          slug: Schema.String,
          label: Schema.String,
          enabled: Schema.Boolean,
        }),
      ),
    ),
  ),
});
import {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "../errors.js";
import { NotificationTypeEnum } from "../schemas/work-item-sub.js";

const error = Schema.Union([
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
]);
const nullableString = Schema.NullOr(Schema.String);
export const BobProjectSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  name: Schema.String,
  key: Schema.String,
  leadUserId: nullableString,
  forgeGraphAppId: nullableString,
  repoUrl: nullableString,
  defaultBranch: nullableString,
  description: nullableString,
  color: nullableString,
  status: Schema.String,
  automationSettings: AutomationSettingsSchema,
  planningProvider: Schema.String,
  defaultAgentType: nullableString,
  linearProjectId: nullableString,
  externalProvider: nullableString,
  externalId: nullableString,
  sourceMetadata: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.String,
  updatedAt: nullableString,
});
const counts = Schema.Struct({
  issues: Schema.Number,
  tasks: Schema.Number,
  epics: Schema.Number,
  active: Schema.Number,
});
const repository = Schema.NullOr(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    path: nullableString,
    branch: nullableString,
    mainBranch: nullableString,
    remoteProvider: nullableString,
    remoteOwner: nullableString,
    remoteName: nullableString,
    remoteUrl: nullableString,
    buildSystem: nullableString,
    dirty: Schema.NullOr(Schema.Boolean),
    stale: Schema.NullOr(Schema.Boolean),
    discoveryStatus: nullableString,
  }),
);
const capabilities = Schema.Struct({
  template: Schema.NullOr(
    Schema.Struct({
      slug: Schema.Literal("create-gmacko-app"),
      label: Schema.String,
      confidence: Schema.Literal("high"),
      frontendApps: Schema.Array(Schema.String),
      evidence: Schema.Array(Schema.String),
      hasAiWorkflow: Schema.Boolean,
      hasClaudeGstack: Schema.Boolean,
      hasRepoSkill: Schema.Boolean,
      hasStorybook: Schema.Boolean,
      hasIntegrationManifest: Schema.Boolean,
      hasPlaywright: Schema.Boolean,
      hasMaestro: Schema.Boolean,
    }),
  ),
});
export const ProjectListRpc = Rpc.make("project.list", {
  payload: Schema.Struct({ workspaceId: Schema.String }),
  success: Schema.Array(
    Schema.Struct({
      project: BobProjectSchema,
      counts,
      linkedRepository: repository,
      _latestActivity: nullableString,
    }),
  ),
  error,
});
export const ProjectGetRpc = Rpc.make("project.get", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.NullOr(
    Schema.Struct({
      project: BobProjectSchema,
      counts,
      linkedRepository: repository,
      capabilities,
      workspace: Schema.optional(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          slug: Schema.String,
        }),
      ),
    }),
  ),
  error,
});
export const ProjectCreateRpc = Rpc.make("project.create", {
  payload: Schema.Struct({
    workspaceId: Schema.String,
    name: Schema.String,
    key: Schema.String,
    description: Schema.optional(Schema.String),
    color: Schema.optional(Schema.String),
  }),
  success: BobProjectSchema,
  error,
});
export const ProjectUpdateAutomationSettingsRpc = Rpc.make(
  "project.updateAutomationSettings",
  {
    payload: Schema.Struct({
      projectId: Schema.String,
      settings: AutomationSettingsSchema,
    }),
    success: BobProjectSchema,
    error,
  },
);
export const ProjectSetDefaultAgentRpc = Rpc.make("project.setDefaultAgent", {
  payload: Schema.Struct({
    projectId: Schema.String,
    defaultAgentType: nullableString,
  }),
  success: BobProjectSchema,
  error,
});
const uuid = Schema.String.check(Schema.isUUID());
const ids = Schema.Array(uuid).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
);
export const ReorderQueueRpc = Rpc.make("workItem.reorderQueue", {
  payload: Schema.Struct({ workspaceId: uuid, workItemIds: ids }),
  success: Schema.Struct({ success: Schema.Boolean }),
  error,
});
export const UnseenTransitionsRpc = Rpc.make("notification.unseenTransitions", {
  payload: Schema.Void,
  success: Schema.Struct({
    count: Schema.Number,
    rows: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        sessionId: Schema.String,
        transition: Schema.String,
        payload: Schema.Record(Schema.String, Schema.Unknown),
        createdAt: Schema.String,
      }),
    ),
  }),
  error,
});
export const MarkTransitionsSeenRpc = Rpc.make(
  "notification.markTransitionsSeen",
  {
    payload: Schema.Struct({ ids }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error,
  },
);
const preference = Schema.Struct({
  type: NotificationTypeEnum,
  channel: Schema.Literals(["push", "email", "in_app"]),
  enabled: Schema.Boolean,
});
export const ListNotificationPreferencesRpc = Rpc.make(
  "settings.listNotificationPreferences",
  {
    payload: Schema.Void,
    success: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        channel: Schema.String,
        enabled: Schema.Boolean,
      }),
    ),
    error,
  },
);
export const SetNotificationPreferenceRpc = Rpc.make(
  "settings.setNotificationPreference",
  {
    payload: preference,
    success: Schema.Struct({ ok: Schema.Boolean }),
    error,
  },
);
export const ResetNotificationPreferencesRpc = Rpc.make(
  "settings.resetNotificationPreferences",
  {
    payload: Schema.Void,
    success: Schema.Struct({ ok: Schema.Boolean }),
    error,
  },
);
export const NativeRpc = RpcGroup.make(
  ProjectListRpc,
  ProjectGetRpc,
  ProjectCreateRpc,
  ProjectUpdateAutomationSettingsRpc,
  ProjectSetDefaultAgentRpc,
  ReorderQueueRpc,
  UnseenTransitionsRpc,
  MarkTransitionsSeenRpc,
  ListNotificationPreferencesRpc,
  SetNotificationPreferenceRpc,
  ResetNotificationPreferencesRpc,
);
