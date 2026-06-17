export function claudeOracleArgs(
  persona: { allowedTools?: string[] } | undefined,
  mcpConfigPath: string | null,
): { mcpArgs: string[]; toolsToAdd: string[] } {
  const wantsOracle = Boolean(persona?.allowedTools?.includes("mcp__ooda__oracle_query"));
  if (!wantsOracle || !mcpConfigPath) return { mcpArgs: [], toolsToAdd: [] };
  return { mcpArgs: ["--mcp-config", mcpConfigPath], toolsToAdd: ["mcp__ooda__oracle_query"] };
}
