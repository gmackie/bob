import type { AgentType } from "@bob/projects/schema";

/**
 * The agent used when nothing is configured anywhere in the hierarchy.
 * Matches the historical hardcoded fallback at the session-creation sites.
 */
export const DEFAULT_AGENT_TYPE: AgentType = "claude";

export interface ResolveAgentTypeInput {
  /** Per-work-item override (`workItems.agentTypeOverride`). */
  workItemOverride?: string | null;
  /** Project default (`projects.defaultAgentType`). */
  projectDefault?: string | null;
  /** Workspace default (`workspaces.defaultAgentType`). */
  workspaceDefault?: string | null;
}

/**
 * Resolve the effective agent type for a piece of work, walking the
 * configuration hierarchy: work-item override -> project default ->
 * workspace default -> hardcoded fallback.
 *
 * Empty strings and nulls are treated as "unset" and fall through. The
 * return is typed as `AgentType`, but callers that pass DB strings get
 * back whatever was stored — validation of stored values happens at write
 * time via the `agentTypeEnum` zod schemas.
 */
export function resolveAgentType(input: ResolveAgentTypeInput): AgentType {
  const candidate =
    nonEmpty(input.workItemOverride) ??
    nonEmpty(input.projectDefault) ??
    nonEmpty(input.workspaceDefault);
  return (candidate ?? DEFAULT_AGENT_TYPE) as AgentType;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}
