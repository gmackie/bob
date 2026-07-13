import type { ApiKeyPermission } from "@bob/auth";

export type DeviceHeartbeatMethod = "GET" | "POST";

export interface DeviceHeartbeatSessionRow {
  id: string;
  title: string | null;
  agentType: string;
  status: string;
  lastActivityAt: string | null;
  updatedAt: string | null;
}

export interface DeviceHeartbeatSession {
  id: string;
  title: string;
  agentType: string;
  status: string;
  lastActivityAt: string | null;
}

export interface DeviceHeartbeatResponse {
  ok: true;
  selectedSession: DeviceHeartbeatSession | null;
  sessions: DeviceHeartbeatSession[];
}

const ACTIVE_STATUSES = new Set([
  "running",
  "starting",
  "pending",
  "awaiting_input",
  // Paused awaiting a human decision — still active (the "needs you" state).
  "blocked",
  // Lease expired: contact lost, process fate unknown — still active.
  "host_unknown",
]);

export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function canUseDeviceHeartbeat(
  permissions: ApiKeyPermission[],
  method: DeviceHeartbeatMethod,
): boolean {
  if (permissions.includes("admin")) return true;
  if (method === "GET") return permissions.includes("read");
  return permissions.includes("write");
}

export function buildDeviceHeartbeatResponse(
  rows: DeviceHeartbeatSessionRow[],
): DeviceHeartbeatResponse {
  const sessions = rows
    .slice()
    .sort(compareSessions)
    .map((row) => ({
      id: row.id,
      title: row.title || row.id,
      agentType: row.agentType,
      status: row.status,
      lastActivityAt: row.lastActivityAt ?? row.updatedAt ?? null,
    }));

  const selectedSession =
    sessions.find((session) => ACTIVE_STATUSES.has(session.status)) ?? null;

  return {
    ok: true,
    selectedSession,
    sessions,
  };
}

function compareSessions(
  left: DeviceHeartbeatSessionRow,
  right: DeviceHeartbeatSessionRow,
) {
  const leftActive = ACTIVE_STATUSES.has(left.status);
  const rightActive = ACTIVE_STATUSES.has(right.status);
  if (leftActive !== rightActive) return leftActive ? -1 : 1;

  return timestampOf(right) - timestampOf(left);
}

function timestampOf(row: DeviceHeartbeatSessionRow) {
  const value = row.lastActivityAt ?? row.updatedAt;
  return value ? Date.parse(value) || 0 : 0;
}
