import "server-only";
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

import type { HandlerContext } from "@bob/api/handlers/context.js";
import { makeWorkItemsRpcHandlers } from "@bob/api/rpc-handlers/workItems.js";
import { makePlanningRpcHandlers } from "@bob/api/rpc-handlers/planning.js";
import { makePlanSessionRpcHandlers } from "@bob/api/rpc-handlers/planSession.js";
import { makePlanRpcHandlers } from "@bob/api/rpc-handlers/plan.js";
import { makeDispatchRpcHandlers } from "@bob/api/rpc-handlers/dispatch.js";
import { makeSkillRpcHandlers } from "@bob/api/rpc-handlers/skill.js";
import { makeSnapshotRpcHandlers } from "@bob/api/rpc-handlers/snapshot.js";
import { makeCheckpointRpcHandlers } from "@bob/api/rpc-handlers/checkpoint.js";
import { makeForgeGraphRpcHandlers } from "@bob/api/rpc-handlers/forgegraph.js";
import { makeWebhookRpcHandlers } from "@bob/api/rpc-handlers/webhook.js";
import { makePublicApiRpcHandlers } from "@bob/api/rpc-handlers/publicApi.js";
import { makeRequirementRpcHandlers } from "@bob/api/rpc-handlers/requirement.js";
import { makeLinkRpcHandlers } from "@bob/api/rpc-handlers/link.js";

import { runtimeLayer, authMiddlewareLayer } from "./layers.js";

// ---------------------------------------------------------------------------
// Bob Effect-RPC server — mounts at /api/rpc alongside the existing /api/trpc.
//
// Serves 4 groups behind AuthMiddleware:
//   - HealthRpc          (1 procedure  — built-in probe)
//   - WorkItemsRpc       (31 procedures — work-items, artifacts, links, etc.)
//   - PlanningRpc        (67 procedures — planning, sessions, dispatch, skills)
//   - ExternalRpc        (31 procedures — forgegraph, webhooks, public API)
//
// Handler context bridging: the tRPC-era handler functions expect a
// `HandlerContext { db, userId }` provided eagerly. In the Effect-RPC server,
// `GmackoDb` and `CurrentUser` are Effect services — db is layer-scoped and
// stable, while `CurrentUser` is per-request (injected by `AuthMiddleware`).
//
// `liftHandlers` wraps each handler factory so that every returned Effect
// reads `CurrentUser` + `GmackoDb` per-request, builds a fresh
// `HandlerContext`, and delegates to the underlying factory/handler.
// ---------------------------------------------------------------------------

// -- Health probe -----------------------------------------------------------

const HealthRpc = Rpc.make("health", {
  payload: Schema.Void,
  success: Schema.Struct({ ok: Schema.Boolean }),
});

// -- Merged group -----------------------------------------------------------

const BobRpcGroup = RpcGroup.make(HealthRpc)
  .merge(WorkItemsRpc, PlanningRpc, ExternalRpc)
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
  H extends Record<string, (input: any) => Effect.Effect<any, any, any>>,
>(
  factory: (ctx: HandlerContext) => H,
): { [K in keyof H]: (input: any) => Effect.Effect<any, any, any> } {
  // Call once with a dummy ctx to discover keys (no side effects — factories
  // just return object literals of closures that capture ctx). The closures
  // are never invoked.
  const sentinel: HandlerContext = { db: null as any, userId: "" };
  const keys = Object.keys(factory(sentinel)) as Array<keyof H & string>;

  const lifted = {} as Record<string, (input: any) => Effect.Effect<any, any, any>>;
  for (const key of keys) {
    lifted[key] = (input: any) =>
      Effect.gen(function* () {
        const db = yield* GmackoDb.asEffect();
        const user = yield* CurrentUser.asEffect();
        const ctx: HandlerContext = { db, userId: user.userId };
        const handlers = factory(ctx);
        return yield* handlers[key]!(input);
      });
  }
  return lifted as any;
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
} as any);

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
} as any);

// ExternalRpc (31 procedures)
const externalHandlers = ExternalRpc.toLayer({
  ...liftHandlers((ctx) => {
    const fg = makeForgeGraphRpcHandlers(ctx);
    const wh = makeWebhookRpcHandlers(ctx);
    const pa = makePublicApiRpcHandlers(ctx);
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
    };
  }),
} as any);

// -- Server -----------------------------------------------------------------

const allHandlers = Layer.mergeAll(
  healthHandlers,
  workItemsHandlers,
  planningHandlers,
  externalHandlers,
);

const serverLayer = RpcServer.layerHttp({
  group: BobRpcGroup,
  path: "/api/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(allHandlers),
  Layer.provide(authMiddlewareLayer),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(runtimeLayer),
) as unknown as LayerType.Layer<never, never, HttpRouter.HttpRouter>;

const { handler } = HttpRouter.toWebHandler(serverLayer);

export { handler as rpcHandler };
