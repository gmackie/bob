import type { OAuthGrant } from "../mcp/types";
import type { McpToolService } from "../mcp/tools";
import { BIZPULSE_SCOPE } from "../mcp/oauth";
import { bizpulseConfig, useClient } from "./client";
import { bizPulseAccess } from "./link";

const allowed = new Set([
  "credential_startup_list",
  "credential_catalog",
  "credential_oauth_info",
  "credential_list",
  "credential_plan_list",
  "credential_plan_get",
  "credential_schedule_list",
  "credential_audit",
  "credential_setup_propose",
  "credential_plan_propose",
  "credential_plan_execute",
  "credential_verify",
]);
const prefix = "bizpulse_";
async function connection(grant: OAuthGrant) {
  if (!grant.scopes.includes(BIZPULSE_SCOPE)) return null;
  const config = bizpulseConfig();
  if (!config) return null;
  const token = await bizPulseAccess(config, grant.userId, grant.workspaceId);
  return token ? { config, token } : null;
}

export function withBizPulseTools(upstream: McpToolService): McpToolService {
  return {
    async list(grant) {
      const tools = await upstream.list(grant);
      try {
        const link = await connection(grant);
        if (!link) return tools;
        const remote = await useClient(link.config, link.token, (client) =>
          client.listTools(),
        );
        return [
          ...tools,
          ...remote.tools
            .filter((tool) => allowed.has(tool.name))
            .map((tool) => ({
              ...tool,
              name: prefix + tool.name,
            })),
        ];
      } catch {
        return tools;
      }
    },
    async call(grant, name, args) {
      if (!name.startsWith(prefix)) return upstream.call(grant, name, args);
      const target = name.slice(prefix.length);
      if (!allowed.has(target)) throw new Error("Unknown BizPulse tool");
      const link = await connection(grant);
      if (!link)
        throw new Error(
          "Connect BizPulse in Bob settings and grant bob:bizpulse access",
        );
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw new Error("Expected tool arguments");
      // SAFETY: BizPulse validates its tool arguments and checks the selected startup on every call.
      const params = args as Record<string, unknown>;
      const result = await useClient(link.config, link.token, (client) =>
        client.callTool({ name: target, arguments: params }),
      );
      if (result.isError)
        throw new Error(
          "BizPulse rejected the operation. Check the grant, approval, and plan status.",
        );
      return result;
    },
  };
}
