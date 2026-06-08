import type { ServerSessionStatusChanged } from "@bob/ws";

import type { GatewaySession } from "./use-gateway";

export function getLiveDashboardSessions<T extends GatewaySession>(sessions: T[]): T[] {
  return sessions.filter((session) => !isPlanningGatewaySession(session));
}

function isPlanningGatewaySession(session: GatewaySession): boolean {
  if (session.sessionType === "planning") return true;
  if (session.sessionType === "execution") return false;

  const agentType = session.agentType.toLowerCase();
  return agentType.includes("plan") || agentType.includes("planner");
}

export function mergeGatewaySessionStatusChange(
  sessions: GatewaySession[],
  info: ServerSessionStatusChanged,
  nowIso = new Date().toISOString(),
): GatewaySession[] {
  const idx = sessions.findIndex((session) => session.sessionId === info.sessionId);
  if (idx >= 0) {
    const existing = sessions[idx];
    if (!existing) return sessions;
    const next = [...sessions];
    next[idx] = {
      ...existing,
      status: info.status,
      agentType: info.agentType ?? existing.agentType,
      sessionType: info.sessionType ?? existing.sessionType,
      title: info.title ?? existing.title,
      lastActivityAt: nowIso,
      workItemId: info.workItemId ?? existing.workItemId,
      workItemIdentifier:
        info.workItemIdentifier ?? existing.workItemIdentifier,
      draftCount: info.draftCount ?? existing.draftCount,
      producedTaskCount: info.producedTaskCount ?? existing.producedTaskCount,
    };
    return next;
  }

  return [{
    sessionId: info.sessionId,
    status: info.status,
    agentType: info.agentType ?? "unknown",
    sessionType: info.sessionType,
    title: info.title,
    lastActivityAt: nowIso,
    workItemId: info.workItemId,
    workItemIdentifier: info.workItemIdentifier,
    draftCount: info.draftCount,
    producedTaskCount: info.producedTaskCount,
  }, ...sessions];
}
