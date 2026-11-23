import {
  createMcpHandler,
  defineTool,
  type Principal,
  type Tool,
} from "@forgegraph/opium";
import type { makeOAuth } from "./oauth";
import { READ_SCOPE, WRITE_SCOPE } from "./oauth";
import type { McpToolService } from "./tools";
import type { makeApps } from "./apps";
import { McpToolError } from "./errors";
import type { OAuthGrant } from "./types";

const MAX_BODY = 32_768;
// Never return driver errors, stack traces, tokens or internal paths; only an
// McpToolError message, which is written for the caller.
const FAILED =
  "Tool call failed. Check the tool arguments, granted scopes, and workspace access.";

interface BobPrincipal extends Principal {
  readonly grant: OAuthGrant;
}
type ListedTool = Pick<
  Tool<BobPrincipal>,
  "name" | "description" | "inputSchema" | "annotations"
>;

/** Stateless Streamable HTTP via `@forgegraph/opium`: the bearer challenge, the
 * origin guard, the body bound and the JSON-RPC envelope. The grant decides
 * which tools exist, and `tools.call` checks scope and workspace access again
 * on every call. */
export function makeMcpTransport(
  oauth: ReturnType<typeof makeOAuth>,
  tools: McpToolService,
  allowedOrigins: string[] = [],
  apps?: ReturnType<typeof makeApps>,
) {
  const origin = new URL(oauth.resource).origin;
  return createMcpHandler<BobPrincipal>({
    resource: oauth.resource,
    issuer: origin,
    scopes: [READ_SCOPE, WRITE_SCOPE],
    challengeScopes: [READ_SCOPE],
    name: "Bob",
    serverInfo: { name: "bob", version: "1.0.0" },
    instructions:
      "Tools are restricted to the workspace selected during OAuth consent. Use bob_list_projects to discover projects.",
    allowedOrigins: [origin, ...allowedOrigins],
    maxBodyBytes: MAX_BODY,
    verify: async (bearer) => {
      const grant = await oauth.authenticate(
        new Request(oauth.resource, {
          headers: { authorization: `Bearer ${bearer}` },
        }),
      );
      return grant
        ? {
            subject: grant.userId,
            clientId: grant.clientId,
            referenceId: grant.workspaceId,
            scopes: grant.scopes,
            grant,
          }
        : null;
    },
    tools: async ({ grant }) =>
      // SAFETY: `makeTools().list` builds each entry from a zod definition
      // (name, description, z.toJSONSchema object schema, annotations).
      ((await tools.list(grant)) as ListedTool[]).map((tool) =>
        defineTool<BobPrincipal>({
          ...tool,
          // `tools.list` already filtered by grant; `tools.call` re-checks.
          scope: null,
          run: async (args) => {
            try {
              const value = await tools.call(grant, tool.name, args);
              // SAFETY: a non-null, non-array object is a JSON object here;
              // tool results are drizzle row views built from plain records.
              return {
                content: [{ type: "text", text: JSON.stringify(value) }],
                structuredContent:
                  value && typeof value === "object" && !Array.isArray(value)
                    ? (value as Record<string, unknown>)
                    : { result: value },
                isError: false,
              };
            } catch (e) {
              return {
                content: [
                  { type: "text", text: e instanceof McpToolError ? e.message : FAILED },
                ],
                isError: true,
              };
            }
          },
        }),
      ),
    // MCP Apps views: static HTML whose data comes back through tools/call.
    ...(apps ? { resources: { list: () => apps.list(), read: (uri: string) => apps.read(uri) } } : {}),
  });
}
