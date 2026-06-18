/**
 * Effect-RPC handler functions for the publicApi RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 6.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  publicApiRegisterWorkspace,
  publicApiCreateRun,
  publicApiUpdateRun,
  publicApiCreateArtifact,
  publicApiGetRun,
  publicApiListRuns,
  publicApiListRunsByWorkItem,
  publicApiHeartbeat,
  publicApiGenerateApiKey,
  publicApiMirrorT3RuntimeEvent,
} from "../handlers/publicApi.js";
import type { T3RuntimeStatus } from "../services/t3code/runtimeEventMirror.js";

export const makePublicApiRpcHandlers = (ctx: HandlerContext) => ({
  "publicApi.registerWorkspace": ({
    payload,
  }: {
    payload: {
      name: string;
      slug: string;
      machineId: string;
      repoPath?: string;
    };
  }) => wrapHandler(publicApiRegisterWorkspace, ctx, payload, "publicApi"),

  "publicApi.createRun": ({
    payload,
  }: {
    payload: {
      workItemId: string;
      workspaceId: string;
      agentType: string;
      agentConfig?: Record<string, unknown>;
    };
  }) => wrapHandler(publicApiCreateRun, ctx, payload, "publicApi"),

  "publicApi.updateRun": ({
    payload,
  }: {
    payload: {
      runId: string;
      status: "running" | "completed" | "failed";
      summary?: Record<string, unknown>;
    };
  }) => wrapHandler(publicApiUpdateRun, ctx, payload, "publicApi"),

  "publicApi.createArtifact": ({
    payload,
  }: {
    payload: {
      runId: string;
      type: "diff" | "log" | "test-report" | "file-snapshot";
      storageKey: string;
      metadata?: Record<string, unknown>;
    };
  }) => wrapHandler(publicApiCreateArtifact, ctx, payload, "publicApi"),

  "publicApi.mirrorT3RuntimeEvent": ({
    payload,
  }: {
    payload: {
      sessionId?: string;
      taskRunId?: string;
      threadId?: string;
      status: T3RuntimeStatus;
      message: string;
      details?: Record<string, unknown>;
    };
  }) => wrapHandler(publicApiMirrorT3RuntimeEvent, ctx, payload, "publicApi"),

  "publicApi.getRun": ({
    payload,
  }: {
    payload: { runId: string };
  }) => wrapHandler(publicApiGetRun, ctx, payload, "publicApi"),

  "publicApi.listRuns": ({
    payload,
  }: {
    payload: { workspaceId: string; limit: number };
  }) => wrapHandler(publicApiListRuns, ctx, payload, "publicApi"),

  "publicApi.listRunsByWorkItem": ({
    payload,
  }: {
    payload: { workItemId: string; limit: number };
  }) => wrapHandler(publicApiListRunsByWorkItem, ctx, payload, "publicApi"),

  "publicApi.heartbeat": ({
    payload,
  }: {
    payload: {
      workspaceId: string;
      agentTypes?: string[];
      capabilities?: string[];
      runtime?: {
        execution?: Record<string, unknown>;
        t3code?: Record<string, unknown>;
      };
      forgeAvailable?: boolean;
      repos?: Array<{
        name: string;
        path: string;
        isGit: boolean;
        remoteUrl?: string;
        branch?: string;
        dirty?: boolean;
        buildSystem?: string;
        forgeAppId?: string;
      }>;
    };
  }) => wrapHandler(publicApiHeartbeat, ctx, payload, "publicApi"),

  "publicApi.generateApiKey": ({
    payload,
  }: {
    payload: { name: string };
  }) => wrapHandler(publicApiGenerateApiKey, ctx, payload, "publicApi"),
});
