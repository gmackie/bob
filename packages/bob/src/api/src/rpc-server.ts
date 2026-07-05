import type { Layer as LayerType } from "effect";
import { Effect, Layer, Schema } from "effect";
import { Rpc, RpcGroup, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { HttpRouter } from "effect/unstable/http";

import { AuthMiddleware } from "@gmacko/core/auth";
import { CurrentUser } from "@gmacko/core/rpc/context";
import { GmackoDb } from "@gmacko/core/db";

import {
  WorkItemsRpc,
  PlanningRpc,
  ExternalRpc,
} from "@gmacko/bob/contracts";

import { AgentRpc } from "@gmacko/core/contracts/groups/agent";
import { ProjectsRpc } from "@gmacko/core/contracts/groups/projects";
import { SettingsRpc } from "@gmacko/core/contracts/groups/settings";
import { SecretsRpc } from "@gmacko/core/contracts/groups/secrets";
import { AuthRpc } from "@gmacko/core/contracts/groups/auth";

import type { HandlerContext } from "./handlers/context.js";
import { makeWorkItemsRpcHandlers } from "./rpc-handlers/workItems.js";
import { makePlanningRpcHandlers } from "./rpc-handlers/planning.js";
import { makePlanSessionRpcHandlers } from "./rpc-handlers/planSession.js";
import { makePlanRpcHandlers } from "./rpc-handlers/plan.js";
import { makeDispatchRpcHandlers } from "./rpc-handlers/dispatch.js";
import { makeSkillRpcHandlers } from "./rpc-handlers/skill.js";
import { makeSnapshotRpcHandlers } from "./rpc-handlers/snapshot.js";
import { makeCheckpointRpcHandlers } from "./rpc-handlers/checkpoint.js";
import { makeForgeGraphRpcHandlers } from "./rpc-handlers/forgegraph.js";
import { makeWebhookRpcHandlers } from "./rpc-handlers/webhook.js";
import { makePublicApiRpcHandlers } from "./rpc-handlers/publicApi.js";
import { makeIntegrationRpcHandlers } from "./rpc-handlers/integration.js";
import { makeRequirementRpcHandlers } from "./rpc-handlers/requirement.js";
import { makeLinkRpcHandlers } from "./rpc-handlers/link.js";

import { makeAgentHandlers } from "./rpc-layers/agent.js";
import { makeProjectsHandlers } from "./rpc-layers/projects.js";
import { makeSettingsHandlers } from "./rpc-layers/settings.js";
import { makeSecretsHandlers } from "./rpc-layers/secrets.js";
import { makeAuthHandlers } from "./rpc-layers/auth.js";

// ---------------------------------------------------------------------------
// Bob Effect-RPC server assembly — the shared, runtime-agnostic core.
//
// This was extracted from `apps/bob/src/server/rpc.ts` so it can be hosted from
// BOTH the blder web route (dev/Node only — stubbed at the CF Workers edge) AND
// the Node `bob-server`. The two app-local pieces — `runtimeLayer` and
// `authMiddlewareLayer` (which depend on the app's auth/db wiring) — are passed
// in by the caller via `makeRpcHandler`.
//
// Serves 9 groups behind AuthMiddleware.
//
// Handler context bridging: tRPC-era handler functions expect an eager
// `HandlerContext { db, userId }`. `liftHandlers` wraps each factory so every
// returned Effect reads `CurrentUser` + `GmackoDb` per-request, builds a fresh
// `HandlerContext`, and delegates.
// ---------------------------------------------------------------------------

// -- Health probe -----------------------------------------------------------

const HealthRpc = Rpc.make("health", {
  payload: Schema.Void,
  success: Schema.Struct({ ok: Schema.Boolean }),
});

// -- Merged group -----------------------------------------------------------

// Module-local: this server-assembled group (middleware + handlers) is consumed
// only by makeRpcHandler below, where its type is erased at the layer boundary.
// Keeping it unexported avoids a non-portable declaration emit (TS2742) from the
// merged Rpc types reaching into @gmacko/core's deep schema paths. The public
// contract surface is BOB_RPC_GROUPS in ./contracts/bob-rpc-groups.
const BobRpcGroup = RpcGroup.make(HealthRpc)
  .merge(
    WorkItemsRpc,
    PlanningRpc,
    ExternalRpc,
    AgentRpc,
    ProjectsRpc,
    SettingsRpc,
    SecretsRpc,
    AuthRpc,
  )
  .middleware(AuthMiddleware);

// -- Handler-context bridge -------------------------------------------------

/**
 * Wraps a handler-factory function so each handler reads `GmackoDb` and
 * `CurrentUser` from the Effect context per-request, builds a fresh
 * `HandlerContext`, and delegates.
 *
 * The factory is called per-request (it's cheap — just creates closures) so
 * the captured `ctx.userId` is always the authenticated user for that request.
 */
function liftHandlers<
  H extends Record<string, (input: never) => Effect.Effect<unknown, unknown, unknown>>,
>(
  factory: (ctx: HandlerContext) => H,
): { [K in keyof H]: (input: never) => Effect.Effect<unknown, unknown, unknown> } {
  // Call once with a dummy ctx to discover keys (no side effects — factories
  // just return object literals of closures that capture ctx). The closures
  // are never invoked.
  const sentinel: HandlerContext = { db: null as unknown as HandlerContext["db"], userId: "", tenantId: "" };
  const keys = Object.keys(factory(sentinel)) as (keyof H & string)[];

  const lifted = {} as Record<string, (input: never) => Effect.Effect<unknown, unknown, unknown>>;
  for (const key of keys) {
    lifted[key] = (input: never) =>
      Effect.gen(function* () {
        const db = yield* GmackoDb.asEffect();
        const user = yield* CurrentUser.asEffect();
        const ctx: HandlerContext = {
          // GmackoDb is typed against the core schema; Bob's handlers expect the
          // Bob-schema-typed `Db`. The underlying runtime client carries both
          // table sets — this is a Drizzle cross-instance schema variance only.
          db: db as unknown as HandlerContext["db"],
          userId: user.userId,
          tenantId: process.env.BOB_TENANT_ID,
        };
        const handlers = factory(ctx);
        const handler = handlers[key];
        if (!handler) {
          // Every `key` was discovered from a call to this same `factory`
          // above (see the sentinel call), so a per-request call to the
          // same factory is guaranteed to produce the same key set — this
          // is a real invariant check, not an expected runtime path.
          throw new Error(`liftHandlers: handler "${key}" missing at request time`);
        }
        return yield* handler(input);
      });
  }
  return lifted as { [K in keyof H]: (input: never) => Effect.Effect<unknown, unknown, unknown> };
}

// -- Handler layers ---------------------------------------------------------

// Health — trivial inline handler, no context needed.
const healthHandlers = RpcGroup.make(HealthRpc).toLayer({
  health: () => Effect.succeed({ ok: true }),
});

// WorkItemsRpc (31 procedures)
const workItemsHandlers = WorkItemsRpc.toLayer({
  ...liftHandlers((ctx) => {
    const wi = makeWorkItemsRpcHandlers(ctx);
    const req = makeRequirementRpcHandlers(ctx);
    const lnk = makeLinkRpcHandlers(ctx);
    return {
      "workItem.list": wi["workItems.list"],
      "workItem.get": wi["workItems.get"],
      "workItem.update": wi["workItems.update"],
      "workItem.promoteToTask": wi["workItems.promoteToTask"],
      "workItem.comment.list": wi["workItems.listComments"],
      "workItem.comment.create": wi["workItems.createComment"],
      "workItem.artifact.create": wi["workItems.createArtifact"],
      "workItem.artifact.listCurrent": wi["workItems.listCurrentArtifacts"],
      "workItem.artifact.listChildGroups": wi["workItems.listChildArtifactGroups"],
      "workItem.activity.list": wi["workItems.listActivities"],
      "workItem.activity.listRecent": wi["workItems.listRecentActivities"],
      "workItem.notification.list": wi["workItems.listNotifications"],
      "workItem.notification.create": wi["workItems.createNotification"],
      "workItem.notification.markAsRead": wi["workItems.markNotificationAsRead"],
      "workItem.notification.registerPushToken": wi["workItems.registerPushToken"],
      "workItem.taskRun.listByWorkItem": wi["workItems.taskRun.listByWorkItem"],
      "workItem.taskRun.execute": wi["workItems.taskRun.execute"],
      "workItem.taskRun.listLifecycleEvents": wi["workItems.taskRun.listLifecycleEvents"],
      "workItem.requirement.list": req["requirement.list"],
      "workItem.requirement.create": req["requirement.create"],
      "workItem.requirement.update": req["requirement.update"],
      "workItem.requirement.delete": req["requirement.delete"],
      "workItem.requirement.linkToTask": req["requirement.linkToTask"],
      "workItem.link.list": lnk["link.list"],
      "workItem.link.byId": lnk["link.byId"],
      "workItem.link.byWorktree": lnk["link.byWorktree"],
      "workItem.link.create": lnk["link.create"],
      "workItem.link.update": lnk["link.update"],
      "workItem.link.delete": lnk["link.delete"],
      "workItem.link.linkToPlanningTask": lnk["link.linkToPlanningTask"],
      "workItem.link.linkToGitHubPR": lnk["link.linkToGitHubPR"],
    };
  }),
} as unknown as Parameters<typeof WorkItemsRpc.toLayer>[0]);

// PlanningRpc (67 procedures)
const planningHandlers = PlanningRpc.toLayer({
  ...liftHandlers((ctx) => {
    const pl = makePlanningRpcHandlers(ctx);
    const ps = makePlanSessionRpcHandlers(ctx);
    const pn = makePlanRpcHandlers(ctx);
    const di = makeDispatchRpcHandlers(ctx);
    const sk = makeSkillRpcHandlers(ctx);
    const sn = makeSnapshotRpcHandlers(ctx);
    const cp = makeCheckpointRpcHandlers(ctx);
    return {
      "planning.listWorkspaces": pl["planning.listWorkspaces"],
      "planning.listProjects": pl["planning.listProjects"],
      "planning.getProject": pl["planning.getProject"],
      "planning.listTasks": pl["planning.listTasks"],
      "planning.getTask": pl["planning.getTask"],
      "planning.getTaskByIdentifier": pl["planning.getTaskByIdentifier"],
      "planning.createTask": pl["planning.createTask"],
      "planning.updateTask": pl["planning.updateTask"],
      "planning.addComment": pl["planning.addComment"],
      "planning.listComments": pl["planning.listComments"],
      "planning.searchTasks": pl["planning.searchTasks"],
      "planning.listLabels": pl["planning.listLabels"],
      "planning.listCycles": pl["planning.listCycles"],
      "planning.syncLinearProjects": pl["planning.syncLinearProjects"],
      "planning.getCurrentUser": () =>
        Effect.succeed({
          id: ctx.userId,
          email: "",
          name: ctx.userId,
        }),
      "planning.agentClaimTask": pl["planning.agentClaimTask"],
      "planning.agentReportProgress": pl["planning.agentReportProgress"],
      "planning.agentCompleteTask": pl["planning.agentCompleteTask"],
      "planning.agentFailTask": pl["planning.agentFailTask"],
      "planning.agentGetAvailableTasks": pl["planning.agentGetAvailableTasks"],
      "planning.agentStartSession": pl["planning.agentStartSession"],
      "planning.agentEndSession": pl["planning.agentEndSession"],
      "planning.session.create": ps["planSession.create"],
      "planning.session.start": ps["planSession.start"],
      "planning.session.get": ps["planSession.get"],
      "planning.session.list": ps["planSession.list"],
      "planning.session.listByWorkItem": ps["planSession.listByWorkItem"],
      "planning.session.getActiveForWorkItem": ps["planSession.getActiveForWorkItem"],
      "planning.session.saveArtifact": ps["planSession.saveArtifact"],
      "planning.session.getPriorContext": ps["planSession.getPriorContext"],
      "planning.session.createDraft": ps["planSession.createDraft"],
      "planning.session.updateDraft": ps["planSession.updateDraft"],
      "planning.session.removeDraft": ps["planSession.removeDraft"],
      "planning.session.setDependency": ps["planSession.setDependency"],
      "planning.session.removeDependency": ps["planSession.removeDependency"],
      "planning.session.commitPlan": ps["planSession.commitPlan"],
      "planning.session.commitPlanLocal": ps["planSession.commitPlanLocal"],
      "planning.task.list": pn["plan.list"],
      "planning.task.byId": pn["plan.byId"],
      "planning.task.byWorktree": pn["plan.byWorktree"],
      "planning.task.create": pn["plan.create"],
      "planning.task.update": pn["plan.update"],
      "planning.task.delete": pn["plan.delete"],
      "planning.task.syncFromFile": pn["plan.syncFromFile"],
      "planning.task.addTask": pn["plan.addTask"],
      "planning.task.updateTask": pn["plan.updateTask"],
      "planning.task.deleteTask": pn["plan.deleteTask"],
      "planning.task.reorderTasks": pn["plan.reorderTasks"],
      "planning.dispatch.createBatch": di["dispatch.createBatch"],
      "planning.dispatch.getBatch": di["dispatch.getBatch"],
      "planning.dispatch.updateItemAgent": di["dispatch.updateItemAgent"],
      "planning.dispatch.updateConcurrency": di["dispatch.updateConcurrency"],
      "planning.dispatch.dispatch": di["dispatch.dispatch"],
      "planning.dispatch.checkProgress": di["dispatch.checkProgress"],
      "planning.dispatch.listBatches": di["dispatch.listBatches"],
      "planning.dispatch.resetPipelineState": di["dispatch.resetPipelineState"],
      "planning.skill.list": sk["skill.list"],
      "planning.skill.seed": sk["skill.seed"],
      "planning.skill.getExecution": sk["skill.getExecution"],
      "planning.skill.listExecutions": sk["skill.listExecutions"],
      "planning.skill.recordExecution": sk["skill.recordExecution"],
      "planning.skill.updateExecution": sk["skill.updateExecution"],
      "planning.snapshot.create": sn["planning.snapshot.create"],
      "planning.snapshot.list": sn["planning.snapshot.list"],
      "planning.snapshot.get": sn["planning.snapshot.get"],
      "planning.checkpoint.create": cp["checkpoint.create"],
      "planning.checkpoint.list": cp["checkpoint.list"],
      "planning.checkpoint.branchFrom": cp["checkpoint.branchFrom"],
    };
  }),
} as unknown as Parameters<typeof PlanningRpc.toLayer>[0]);

// ExternalRpc (37 procedures)
const externalHandlers = ExternalRpc.toLayer({
  ...liftHandlers((ctx) => {
    const fg = makeForgeGraphRpcHandlers(ctx);
    const wh = makeWebhookRpcHandlers(ctx);
    const pa = makePublicApiRpcHandlers(ctx);
    const int = makeIntegrationRpcHandlers(ctx);
    return {
      "external.forgegraph.listRevisions": fg["forgegraph.listRevisions"],
      "external.forgegraph.getRevision": fg["forgegraph.getRevision"],
      "external.forgegraph.createRevision": fg["forgegraph.createRevision"],
      "external.forgegraph.triggerBuild": fg["forgegraph.triggerBuild"],
      "external.forgegraph.updateBuildStatus": fg["forgegraph.updateBuildStatus"],
      "external.forgegraph.createDeployment": fg["forgegraph.createDeployment"],
      "external.forgegraph.updateDeploymentStatus": fg["forgegraph.updateDeploymentStatus"],
      "external.forgegraph.ingestRunEvent": fg["forgegraph.ingestRunEvent"],
      "external.forgegraph.listDeployments": fg["forgegraph.listDeployments"],
      "external.forgegraph.listBuilds": fg["forgegraph.listBuilds"],
      "external.forgegraph.approveProdDeploy": fg["forgegraph.approveProdDeploy"],
      "external.forgegraph.listApps": fg["forgegraph.listApps"],
      "external.forgegraph.listUnlinkedApps": fg["forgegraph.listUnlinkedApps"],
      "external.forgegraph.importApp": fg["forgegraph.importApp"],
      "external.webhook.list": wh["webhook.list"],
      "external.webhook.byId": wh["webhook.byId"],
      "external.webhook.create": wh["webhook.create"],
      "external.webhook.update": wh["webhook.update"],
      "external.webhook.delete": wh["webhook.delete"],
      "external.webhook.deliveries": wh["webhook.deliveries"],
      "external.webhook.redeliver": wh["webhook.redeliver"],
      "external.webhook.testWebhook": wh["webhook.testWebhook"],
      "external.publicApi.registerWorkspace": pa["publicApi.registerWorkspace"],
      "external.publicApi.createRun": pa["publicApi.createRun"],
      "external.publicApi.updateRun": pa["publicApi.updateRun"],
      "external.publicApi.createArtifact": pa["publicApi.createArtifact"],
      "external.publicApi.getRun": pa["publicApi.getRun"],
      "external.publicApi.listRuns": pa["publicApi.listRuns"],
      "external.publicApi.listRunsByWorkItem": pa["publicApi.listRunsByWorkItem"],
      "external.publicApi.heartbeat": pa["publicApi.heartbeat"],
      "external.publicApi.generateApiKey": pa["publicApi.generateApiKey"],
      "external.integration.list": int["integration.list"],
      "external.integration.get": int["integration.get"],
      "external.integration.save": int["integration.save"],
      "external.integration.fetchLinearTeams": int["integration.fetchLinearTeams"],
      "external.integration.setupLinear": int["integration.setupLinear"],
      "external.integration.delete": int["integration.delete"],
    };
  }),
} as unknown as Parameters<typeof ExternalRpc.toLayer>[0]);

// AgentRpc (78 procedures)
const agentHandlers = AgentRpc.toLayer({
  ...liftHandlers(makeAgentHandlers),
} as unknown as Parameters<typeof AgentRpc.toLayer>[0]);

// ProjectsRpc (56 procedures)
const projectsHandlers = ProjectsRpc.toLayer({
  ...liftHandlers(makeProjectsHandlers),
} as unknown as Parameters<typeof ProjectsRpc.toLayer>[0]);

// SettingsRpc (20 procedures)
const settingsHandlers = SettingsRpc.toLayer({
  ...liftHandlers(makeSettingsHandlers),
} as unknown as Parameters<typeof SettingsRpc.toLayer>[0]);

// SecretsRpc (14 procedures)
const secretsHandlers = SecretsRpc.toLayer({
  ...liftHandlers(makeSecretsHandlers),
} as unknown as Parameters<typeof SecretsRpc.toLayer>[0]);

// AuthRpc (11 procedures)
const authHandlers = AuthRpc.toLayer({
  ...liftHandlers(makeAuthHandlers),
} as unknown as Parameters<typeof AuthRpc.toLayer>[0]);

/**
 * The merged Layer of every group's handlers. Exported so the REST bridge
 * (Task 4b) can dispatch through the same handlers as the RPC transport.
 */
export const allHandlers = Layer.mergeAll(
  healthHandlers,
  workItemsHandlers,
  planningHandlers,
  externalHandlers,
  agentHandlers,
  projectsHandlers,
  settingsHandlers,
  secretsHandlers,
  authHandlers,
);

/**
 * The app-local Layers the RPC server needs, supplied by the caller because
 * they depend on the app's auth/db wiring (`apps/bob/src/server/layers.ts`).
 */
export interface RpcServerLayers {
  readonly runtimeLayer: LayerType.Layer<unknown, unknown, unknown>;
  readonly authMiddlewareLayer: LayerType.Layer<unknown, unknown, unknown>;
}

/**
 * Build the `/api/rpc` web handler (ndjson Effect-RPC transport over HTTP) from
 * the shared group + handlers and the caller-supplied runtime/auth layers.
 */
export function makeRpcHandler(
  layers: RpcServerLayers,
): (request: Request) => Promise<Response> {
  const serverLayer = RpcServer.layerHttp({
    group: BobRpcGroup,
    path: "/api/rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(allHandlers),
    Layer.provide(layers.authMiddlewareLayer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(layers.runtimeLayer),
  ) as unknown as LayerType.Layer<never, never, HttpRouter.HttpRouter>;

  const { handler } = HttpRouter.toWebHandler(serverLayer);
  return handler;
}
