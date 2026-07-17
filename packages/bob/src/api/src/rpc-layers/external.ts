/**
 * Aggregate layer that maps handler factory outputs to ExternalRpc contract
 * names (31 procedures).
 *
 * Imports the three handler factories (forgegraph, webhook, publicApi),
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
import { adaptRpcHandlers } from "./adapter.js";

export const makeExternalLayer = (ctx: HandlerContext) => {
  const fg = makeForgeGraphRpcHandlers(ctx);
  const wh = makeWebhookRpcHandlers(ctx);
  const pa = makePublicApiRpcHandlers(ctx);

  return ExternalRpc.toLayer(adaptRpcHandlers({
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
  }));
};
