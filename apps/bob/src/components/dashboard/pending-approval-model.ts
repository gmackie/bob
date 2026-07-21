// Pure model for the Pending Approval section — the "needs you" surface.
//
// A run parks in the `blocked` conversation status when the permission-mode
// adapter hits a tool call and waits for a human yes/no. Until someone answers,
// it holds a runner slot (see the gateway sweepAbandonedApprovals) and blocks
// throughput. These are the single most time-sensitive items on the dashboard,
// so they get their own prominent section rather than being folded into
// "Running Now" (where a blocked run otherwise looks like a healthy running one).

export interface PendingApprovalSessionLike {
  id: string;
  title?: string | null;
  agentType?: string | null;
  status: string;
  workItemId?: string | null;
  workItemIdentifierSnapshot?: string | null;
  lastActivityAt?: string | Date | null;
  updatedAt?: string | Date | null;
  createdAt?: string | Date | null;
}

export interface PendingApprovalRow {
  id: string;
  title: string;
  agentLabel: string;
  waitingLabel: string;
  href: string;
}

// Conversation statuses that mean "a human decision is required to proceed".
// `blocked` is the permission gate; keep this a set so a future "needs re-auth"
// style status can join without touching call sites.
const PENDING_APPROVAL_STATUSES = new Set(["blocked"]);

export function isPendingApproval(status: string): boolean {
  return PENDING_APPROVAL_STATUSES.has(status);
}

export function filterPendingApprovalSessions<T extends PendingApprovalSessionLike>(
  sessions: T[],
): T[] {
  // Defensive: a caller passing a non-array (e.g. a paginated { items } object
  // by mistake) must not throw — a thrown render here blanks the whole page.
  if (!Array.isArray(sessions)) return [];
  return sessions.filter((s) => isPendingApproval(s.status));
}

function agentLabel(agentType: string | null | undefined): string {
  const normalized = (agentType ?? "").trim().toLowerCase();
  if (!normalized) return "Agent";
  if (normalized.includes("claude")) return "Claude";
  if (normalized.includes("grok")) return "Grok";
  if (normalized.includes("codex")) return "Codex";
  if (normalized.includes("cursor")) return "Cursor";
  return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
}

function sessionTitle(session: PendingApprovalSessionLike): string {
  const title = session.title?.trim();
  if (title) return title;
  const identifier = session.workItemIdentifierSnapshot?.trim();
  if (identifier) return identifier;
  return session.id.slice(0, 8);
}

function timestampValue(value: string | Date | null | undefined): number {
  if (!value) return Number.NaN;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function formatWaitingLabel(
  value: string | Date | null | undefined,
  now: Date,
): string {
  const ts = timestampValue(value);
  if (!Number.isFinite(ts)) return "Waiting";
  const diffMs = Math.max(0, now.getTime() - ts);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Waiting just now";
  if (minutes < 60) return `Waiting ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Waiting ${hours}h`;
  return `Waiting ${Math.floor(hours / 24)}d`;
}

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
}

export function buildPendingApprovalRows(input: {
  sessions: PendingApprovalSessionLike[];
  workspaceId?: string | null;
  now?: Date;
  limit?: number;
}): PendingApprovalRow[] {
  const now = input.now ?? new Date();
  return filterPendingApprovalSessions(input.sessions)
    .map((session) => ({
      row: {
        id: session.id,
        title: sessionTitle(session),
        agentLabel: agentLabel(session.agentType),
        waitingLabel: formatWaitingLabel(
          session.lastActivityAt ?? session.updatedAt ?? session.createdAt,
          now,
        ),
        href: appendWorkspaceParam(`/sessions/${session.id}`, input.workspaceId),
      } satisfies PendingApprovalRow,
      // Longest-waiting first — the most overdue approval is the most urgent.
      timestamp: timestampValue(
        session.lastActivityAt ?? session.updatedAt ?? session.createdAt,
      ),
    }))
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(0, input.limit ?? 20)
    .map((entry) => entry.row);
}
