/// <reference types="@cloudflare/workers-types" />
import { AsyncLocalStorage } from "node:async_hooks";
import { isViewer } from "../../lib/sdlc-viewers";
import { McpToolError } from "./errors";
import type { OAuthGrant } from "./types";

export interface McpSdlcEnv {
  SDLC_EDGE?: DurableObjectNamespace;
  SDLC_EDGE_WORKSPACE_ID?: string;
  SDLC_VIEWER_USER_IDS?: string;
}

// Set by the Worker for the current /mcp request. Local Node hosts have no edge binding.
export const mcpSdlcEnv = new AsyncLocalStorage<McpSdlcEnv>();

export function authorizedEdge(grant: OAuthGrant, env: McpSdlcEnv) {
  if (!env.SDLC_EDGE || !env.SDLC_EDGE_WORKSPACE_ID)
    throw new McpToolError("Bob’s SDLC edge is unavailable.");
  if (
    env.SDLC_EDGE_WORKSPACE_ID !== grant.workspaceId ||
    !isViewer(grant.userId, env.SDLC_VIEWER_USER_IDS)
  )
    throw new McpToolError("SDLC access is unavailable for this workspace and user.");
  return env.SDLC_EDGE.get(env.SDLC_EDGE.idFromName(grant.workspaceId));
}

export async function readSdlc(grant: OAuthGrant, env: McpSdlcEnv, threadId?: string, raw = false) {
  const edge = authorizedEdge(grant, env);
  const url = new URL("https://sdlc-edge/mcp");
  if (threadId) url.searchParams.set("threadId", threadId);
  if (raw) url.searchParams.set("raw", "true");
  const response = await edge.fetch(url.href);
  if (!response.ok) throw new McpToolError("Could not read Bob’s SDLC edge.");
  return response.json();
}
