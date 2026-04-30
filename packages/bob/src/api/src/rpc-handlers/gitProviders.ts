/**
 * Effect-RPC handler functions for the gitProviders RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 4.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  gitProvidersListConnections,
  gitProvidersConnectPat,
  gitProvidersDisconnect,
  gitProvidersTestConnection,
  gitProvidersSetDefaultForRepo,
  gitProvidersDetectRemote,
} from "../handlers/gitProviders.js";

export const makeGitProvidersRpcHandlers = (ctx: HandlerContext) => ({
  "gitProviders.listConnections": ({
    payload,
  }: {
    payload: void;
  }) => wrapHandler(gitProvidersListConnections, ctx, payload, "gitProviders"),

  "gitProviders.connectPat": ({
    payload,
  }: {
    payload: {
      provider: "github" | "gitlab" | "gitea";
      accessToken: string;
      instanceUrl?: string;
    };
  }) => wrapHandler(gitProvidersConnectPat, ctx, payload, "gitProviders"),

  "gitProviders.disconnect": ({
    payload,
  }: {
    payload: { connectionId: string };
  }) => wrapHandler(gitProvidersDisconnect, ctx, payload, "gitProviders"),

  "gitProviders.testConnection": ({
    payload,
  }: {
    payload: {
      connectionId?: string;
      provider?: "github" | "gitlab" | "gitea";
      instanceUrl?: string;
    };
  }) => wrapHandler(gitProvidersTestConnection, ctx, payload, "gitProviders"),

  "gitProviders.setDefaultForRepo": ({
    payload,
  }: {
    payload: { repositoryId: string; connectionId: string };
  }) => wrapHandler(gitProvidersSetDefaultForRepo, ctx, payload, "gitProviders"),

  "gitProviders.detectRemote": ({
    payload,
  }: {
    payload: { repositoryId: string };
  }) => wrapHandler(gitProvidersDetectRemote, ctx, payload, "gitProviders"),
});
