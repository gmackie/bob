// Deterministic in-memory stubs for the ExternalRpc contract group.
// Returns plausible mock data so consumers can wire up typed calls before
// real service handlers land. 7B-4C Task 8 + Task 9.
import { Effect } from "effect";

import { ExternalRpc } from "../groups/external.js";

export const ExternalStubLayer = ExternalRpc.toLayer({
  // ForgeGraph (14 — Task 8)
  "external.forgegraph.listRevisions": () => Effect.succeed([]),
  "external.forgegraph.getRevision": () => Effect.succeed(null),
  "external.forgegraph.createRevision": () =>
    Effect.succeed({
      id: "stub-rev-1",
      repoId: "stub-repo-1",
      revId: "abc123",
    }),
  "external.forgegraph.triggerBuild": () =>
    Effect.succeed({
      id: "stub-build-1",
      revisionId: "stub-rev-1",
      status: "queued",
    }),
  "external.forgegraph.updateBuildStatus": () =>
    Effect.succeed({
      id: "stub-build-1",
      revisionId: "stub-rev-1",
      status: "passed",
    }),
  "external.forgegraph.createDeployment": () =>
    Effect.succeed({
      id: "stub-deploy-1",
      revisionId: "stub-rev-1",
      buildId: "stub-build-1",
      repoId: "stub-repo-1",
      environment: "staging",
      status: "deploying",
    }),
  "external.forgegraph.updateDeploymentStatus": () =>
    Effect.succeed({
      id: "stub-deploy-1",
      revisionId: "stub-rev-1",
      buildId: "stub-build-1",
      repoId: "stub-repo-1",
      environment: "staging",
      status: "healthy",
    }),
  "external.forgegraph.ingestRunEvent": () =>
    Effect.succeed({
      id: "stub-event-1",
      runId: "stub-run-1",
      repoId: "stub-repo-1",
      revisionId: "stub-rev-1",
      eventType: "created",
    }),
  "external.forgegraph.listDeployments": () => Effect.succeed([]),
  "external.forgegraph.listBuilds": () => Effect.succeed([]),
  "external.forgegraph.approveProdDeploy": () =>
    Effect.succeed({
      id: "stub-deploy-1",
      revisionId: "stub-rev-1",
      buildId: "stub-build-1",
      repoId: "stub-repo-1",
      environment: "prod",
      status: "deploying",
    }),
  "external.forgegraph.listApps": () => Effect.succeed([]),
  "external.forgegraph.listUnlinkedApps": () => Effect.succeed([]),
  "external.forgegraph.importApp": () =>
    Effect.succeed({
      id: "stub-project-1",
      workspaceId: "stub-ws-1",
      name: "stub app",
      key: "STUB",
    }),

  // Webhook (8 — Task 9)
  "external.webhook.list": () => Effect.succeed([]),
  "external.webhook.byId": () => Effect.succeed(null),
  "external.webhook.create": () =>
    Effect.succeed({
      id: "stub-whcfg-1",
      url: "https://example.com/webhook",
      secret: "stub-secret-0123456",
      events: [],
      active: true,
    }),
  "external.webhook.update": () =>
    Effect.succeed({
      id: "stub-whcfg-1",
      url: "https://example.com/webhook",
      secret: "stub-secret-0123456",
      events: [],
      active: true,
    }),
  "external.webhook.delete": () => Effect.succeed({ ok: true }),
  "external.webhook.deliveries": () => Effect.succeed([]),
  "external.webhook.redeliver": () => Effect.succeed({ ok: true }),
  "external.webhook.testWebhook": () => Effect.succeed({ ok: true }),

  // PublicApi (9 — Task 9)
  "external.publicApi.registerWorkspace": () =>
    Effect.succeed({
      id: "stub-ws-1",
      name: "stub workspace",
      slug: "stub-workspace",
    }),
  "external.publicApi.createRun": () =>
    Effect.succeed({
      id: "stub-run-1",
      workItemId: "stub-wi-1",
      workspaceId: "stub-ws-1",
      agentType: "codex",
      status: "queued",
    }),
  "external.publicApi.updateRun": () =>
    Effect.succeed({
      id: "stub-run-1",
      workItemId: "stub-wi-1",
      workspaceId: "stub-ws-1",
      agentType: "codex",
      status: "running",
    }),
  "external.publicApi.createArtifact": () =>
    Effect.succeed({
      id: "stub-artifact-1",
      runId: "stub-run-1",
      type: "log",
      storageKey: "stub/log/1",
    }),
  "external.publicApi.getRun": () => Effect.succeed(null),
  "external.publicApi.listRuns": () => Effect.succeed([]),
  "external.publicApi.listRunsByWorkItem": () => Effect.succeed([]),
  "external.publicApi.heartbeat": () => Effect.succeed({ ok: true }),
  "external.publicApi.generateApiKey": () =>
    Effect.succeed({
      id: "stub-apikey-1",
      key: "bob_stub_key_0000",
      prefix: "bob_stub_key",
    }),
});
