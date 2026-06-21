import { ExternalRpc } from "@gmacko/bob/contracts";

import type { ClientRuntime } from "./internal/runtime.js";
import { makeInvoke, type RpcMethod } from "./internal/invoke.js";

export interface ExternalClient {
  readonly forgegraph: Record<string, RpcMethod> & {
    readonly listRevisions: RpcMethod;
    readonly getRevision: RpcMethod;
    readonly listApps: () => Promise<unknown>;
    readonly approveProdDeploy: RpcMethod;
  };
  readonly webhook: Record<string, RpcMethod> & {
    readonly list: RpcMethod;
    readonly byId: RpcMethod;
    readonly create: RpcMethod;
    readonly update: RpcMethod;
    readonly delete: RpcMethod;
    readonly deliveries: RpcMethod;
    readonly redeliver: RpcMethod;
    readonly testWebhook: RpcMethod;
  };
  readonly publicApi: Record<string, RpcMethod>;
}

export const makeExternalClient = (runtime: ClientRuntime): ExternalClient => {
  const invoke = makeInvoke(runtime, ExternalRpc);

  return {
    forgegraph: {
      listRevisions: (input) =>
        invoke("external.forgegraph.listRevisions", input),
      getRevision: (input) =>
        invoke("external.forgegraph.getRevision", input),
      createRevision: (input) =>
        invoke("external.forgegraph.createRevision", input),
      triggerBuild: (input) =>
        invoke("external.forgegraph.triggerBuild", input),
      updateBuildStatus: (input) =>
        invoke("external.forgegraph.updateBuildStatus", input),
      createDeployment: (input) =>
        invoke("external.forgegraph.createDeployment", input),
      updateDeploymentStatus: (input) =>
        invoke("external.forgegraph.updateDeploymentStatus", input),
      ingestRunEvent: (input) =>
        invoke("external.forgegraph.ingestRunEvent", input),
      listDeployments: (input) =>
        invoke("external.forgegraph.listDeployments", input),
      listBuilds: (input) =>
        invoke("external.forgegraph.listBuilds", input),
      approveProdDeploy: (input) =>
        invoke("external.forgegraph.approveProdDeploy", input),
      listApps: () => invoke("external.forgegraph.listApps"),
      listUnlinkedApps: (input) =>
        invoke("external.forgegraph.listUnlinkedApps", input),
      importApp: (input) => invoke("external.forgegraph.importApp", input),
    },
    webhook: {
      list: (input) => invoke("external.webhook.list", input),
      byId: (input) => invoke("external.webhook.byId", input),
      create: (input) => invoke("external.webhook.create", input),
      update: (input) => invoke("external.webhook.update", input),
      delete: (input) => invoke("external.webhook.delete", input),
      deliveries: (input) =>
        invoke("external.webhook.deliveries", input),
      redeliver: (input) => invoke("external.webhook.redeliver", input),
      testWebhook: (input) =>
        invoke("external.webhook.testWebhook", input),
    },
    publicApi: {
      registerWorkspace: (input) =>
        invoke("external.publicApi.registerWorkspace", input),
      createRun: (input) => invoke("external.publicApi.createRun", input),
      updateRun: (input) => invoke("external.publicApi.updateRun", input),
      createArtifact: (input) =>
        invoke("external.publicApi.createArtifact", input),
      getRun: (input) => invoke("external.publicApi.getRun", input),
      listRuns: (input) => invoke("external.publicApi.listRuns", input),
      listRunsByWorkItem: (input) =>
        invoke("external.publicApi.listRunsByWorkItem", input),
      heartbeat: (input) => invoke("external.publicApi.heartbeat", input),
      generateApiKey: (input) =>
        invoke("external.publicApi.generateApiKey", input),
    },
  };
};
