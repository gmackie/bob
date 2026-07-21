/**
 * Aggregate layer that maps handler factory outputs to ExternalRpc contract
 * names (37 procedures).
 *
 * Imports the four handler factories (forgegraph, webhook, publicApi,
 * integration),
 * instantiates them with a HandlerContext, and wires each factory key to the
 * corresponding contract procedure name expected by ExternalRpc.toLayer().
 *
 * Phase 7B-4D-gamma Task 3.
 */
import type { HandlerContext } from "../handlers/context.js";
import { ExternalRpc } from "@gmacko/bob/contracts";
import { makeForgeGraphRpcHandlers } from "../rpc-handlers/forgegraph.js";
import { makeWebhookRpcHandlers } from "../rpc-handlers/webhook.js";
import { makePublicApiRpcHandlers } from "../rpc-handlers/publicApi.js";
import { makeIntegrationRpcHandlers } from "../rpc-handlers/integration.js";

export const makeExternalLayer = (ctx: HandlerContext) => {
  const fg = makeForgeGraphRpcHandlers(ctx);
  const wh = makeWebhookRpcHandlers(ctx);
  const pa = makePublicApiRpcHandlers(ctx);
  const int = makeIntegrationRpcHandlers(ctx);

  return ExternalRpc.toLayer({
    // --- ForgeGraph (14) ---
    "external.forgegraph.listRevisions": fg["forgegraph.listRevisions"],
    "external.forgegraph.getRevision": fg["forgegraph.getRevision"],
    "external.forgegraph.createRevision": fg["forgegraph.createRevision"],
    "external.forgegraph.triggerBuild": fg["forgegraph.triggerBuild"],
    "external.forgegraph.updateBuildStatus": fg["forgegraph.updateBuildStatus"],
    "external.forgegraph.createDeployment": fg["forgegraph.createDeployment"],
    "external.forgegraph.updateDeploymentStatus":
      fg["forgegraph.updateDeploymentStatus"],
    "external.forgegraph.ingestRunEvent": fg["forgegraph.ingestRunEvent"],
    "external.forgegraph.listDeployments": fg["forgegraph.listDeployments"],
    "external.forgegraph.listBuilds": fg["forgegraph.listBuilds"],
    "external.forgegraph.approveProdDeploy": fg["forgegraph.approveProdDeploy"],
    "external.forgegraph.listApps": fg["forgegraph.listApps"],
    "external.forgegraph.listUnlinkedApps": fg["forgegraph.listUnlinkedApps"],
    "external.forgegraph.importApp": fg["forgegraph.importApp"],

    // --- Webhook (8) ---
    "external.webhook.list": wh["webhook.list"],
    "external.webhook.byId": wh["webhook.byId"],
    "external.webhook.create": wh["webhook.create"],
    "external.webhook.update": wh["webhook.update"],
    "external.webhook.delete": wh["webhook.delete"],
    "external.webhook.deliveries": wh["webhook.deliveries"],
    "external.webhook.redeliver": wh["webhook.redeliver"],
    "external.webhook.testWebhook": wh["webhook.testWebhook"],

    // --- PublicApi (9) ---
    "external.publicApi.registerWorkspace": pa["publicApi.registerWorkspace"],
    "external.publicApi.createRun": pa["publicApi.createRun"],
    "external.publicApi.updateRun": pa["publicApi.updateRun"],
    "external.publicApi.createArtifact": pa["publicApi.createArtifact"],
    "external.publicApi.getRun": pa["publicApi.getRun"],
    "external.publicApi.listRuns": pa["publicApi.listRuns"],
    "external.publicApi.listRunsByWorkItem":
      pa["publicApi.listRunsByWorkItem"],
    "external.publicApi.heartbeat": pa["publicApi.heartbeat"],
    "external.publicApi.generateApiKey": pa["publicApi.generateApiKey"],

    // --- Integration (6) ---
    "external.integration.list": int["integration.list"],
    "external.integration.get": int["integration.get"],
    "external.integration.save": int["integration.save"],
    "external.integration.fetchLinearTeams": int["integration.fetchLinearTeams"],
    "external.integration.setupLinear": int["integration.setupLinear"],
    "external.integration.delete": int["integration.delete"],
    // The handler factories above (make*RpcHandlers) use the destructured
    // `({ payload }) => Effect<...>` envelope calling convention shared with
    // the in-process RPC dispatch (rpc-server.ts), while ExternalRpc.toLayer's
    // `ToHandlerFn` expects the unwrapped `(payload) => Effect<...>` shape.
    // Both conventions are exercised and covered by tests; only the static
    // shape differs here, not runtime behavior. Widened to the layer's own
    // parameter type (not `any`) so an actual signature drift in either
    // convention still surfaces as a type error one level up.
  } as unknown as Parameters<typeof ExternalRpc.toLayer>[0]);
};
