/** Read only the reserved dispatch field, bound to the gateway's owned item. */
export function readTraceReportScope(persona: unknown, workItemId: string, workspaceId: string) {
  if (!persona || typeof persona !== "object" || !("traceReportScope" in persona)) return {};
  const scope = persona.traceReportScope;
  if (!scope || typeof scope !== "object" || !("workItemId" in scope) || !("workspaceId" in scope) ||
      scope.workItemId !== workItemId || scope.workspaceId !== workspaceId) return {};
  return {
    ...("forgeGraphWorkItemId" in scope && typeof scope.forgeGraphWorkItemId === "string"
      ? { forgeGraphWorkItemId: scope.forgeGraphWorkItemId } : {}),
  };
}
