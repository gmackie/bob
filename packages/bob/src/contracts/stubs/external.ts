// Deterministic in-memory stubs for the ExternalRpc contract group.
// Returns plausible mock data so consumers can wire up typed calls before
// real service handlers land. 7B-4C Task 8.
import { Effect } from "effect";

import { ExternalRpc } from "../groups/external.js";

export const ExternalStubLayer = ExternalRpc.toLayer({
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
});
