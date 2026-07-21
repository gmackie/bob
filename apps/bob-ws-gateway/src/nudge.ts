import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerWorkspaceInvalidationType } from "./protocol.js";
import type { InternalPrincipal } from "./auth.js";

interface NudgeBody {
  sessionId: string;
  workspaceId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  description?: string;
  identifier?: string;
  branch?: string;
  sessionType?: "execution" | "planning";
  planningContext?: Record<string, unknown>;
  personaId?: string;
  personaConfig?: {
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface NudgeConfig {
  /**
   * Async bearer authorization returning the principal (API key owner or the
   * legacy shared secret), or null if unauthorized.
   */
  authorize: (bearer: string) => Promise<InternalPrincipal | null>;
  /**
   * Resolve the owning userId of a workspace. Used to scope an api-key
   * principal to workspaces it owns — without this any user's key could spawn
   * agents in any workspace via /internal/nudge.
   */
  resolveWorkspaceOwner: (workspaceId: string) => Promise<string | null>;
  /** Best-effort audit of the acting principal. */
  onAudit?: (principal: InternalPrincipal, action: string, payload: Record<string, unknown>) => void;
  onNudge: (body: NudgeBody) => void;
}

export interface WorkspaceEventBody {
  type: ServerWorkspaceInvalidationType;
  workspaceId: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}

export interface WorkspaceEventConfig {
  authorize: (bearer: string) => Promise<InternalPrincipal | null>;
  resolveWorkspaceOwner: (workspaceId: string) => Promise<string | null>;
  onAudit?: (principal: InternalPrincipal, action: string, payload: Record<string, unknown>) => void;
  onEvent: (body: WorkspaceEventBody) => void;
}

/**
 * An api-key principal may only act on workspaces it owns. Legacy (shared ops
 * secret) is unscoped. Returns true if allowed.
 */
async function principalOwnsWorkspace(
  principal: InternalPrincipal,
  workspaceId: string,
  resolveWorkspaceOwner: (workspaceId: string) => Promise<string | null>,
): Promise<boolean> {
  if (principal.kind === "legacy") return true;
  const owner = await resolveWorkspaceOwner(workspaceId);
  return owner !== null && owner === principal.userId;
}

/** Extract the bearer token from an Authorization header, or null. */
export function bearerFrom(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

const WORKSPACE_EVENT_TYPES = new Set<ServerWorkspaceInvalidationType>([
  "git_status_changed",
  "planning_session_produced_drafts",
  "planning_session_produced_tasks",
  "project_sync_changed",
  "provider_capacity_changed",
  "provider_limit_changed",
  "queue_order_changed",
  "session_event_appended",
  "task_priority_changed",
  "task_status_changed",
  "work_item_dispatched",
]);

export function createNudgeHandler(cfg: NudgeConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Auth
    const bearer = bearerFrom(req.headers.authorization);
    const principal = bearer ? await cfg.authorize(bearer) : null;
    if (!principal) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // Parse body
    const body = await readJsonBody(req);
    if (!body) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    // Validate fields
    const nudge = body as Partial<NudgeBody>;
    if (!nudge.sessionId || !nudge.workspaceId || !nudge.workingDirectory || !nudge.agentType) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required fields" }));
      return;
    }

    // Scope: a per-user API key may only spawn agents in its own workspaces.
    // Without this, /internal/nudge lets any key run arbitrary agent
    // instructions in any workspace (Codex adversarial P1).
    if (!(await principalOwnsWorkspace(principal, nudge.workspaceId, cfg.resolveWorkspaceOwner))) {
      cfg.onAudit?.(principal, "internal.denied", { endpoint: "nudge", workspaceId: nudge.workspaceId, sessionId: nudge.sessionId });
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: key does not own this workspace" }));
      return;
    }

    cfg.onAudit?.(principal, "internal.nudge", { workspaceId: nudge.workspaceId, sessionId: nudge.sessionId, agentType: nudge.agentType });
    cfg.onNudge(nudge as NudgeBody);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };
}

export function createWorkspaceEventHandler(cfg: WorkspaceEventConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const bearer = bearerFrom(req.headers.authorization);
    const principal = bearer ? await cfg.authorize(bearer) : null;
    if (!principal) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const body = await readJsonBody(req);
    if (!body) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    const event = body as Partial<WorkspaceEventBody>;
    if (
      typeof event.type !== "string" ||
      !WORKSPACE_EVENT_TYPES.has(event.type as ServerWorkspaceInvalidationType) ||
      typeof event.workspaceId !== "string" ||
      !event.workspaceId
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing required fields" }));
      return;
    }

    // Scope workspace fan-out to the api-key principal that owns it.
    if (!(await principalOwnsWorkspace(principal, event.workspaceId, cfg.resolveWorkspaceOwner))) {
      cfg.onAudit?.(principal, "internal.denied", { endpoint: "workspace-event", workspaceId: event.workspaceId, type: event.type });
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: key does not own this workspace" }));
      return;
    }

    cfg.onEvent({
      type: event.type as ServerWorkspaceInvalidationType,
      workspaceId: event.workspaceId,
      entityId: typeof event.entityId === "string" ? event.entityId : undefined,
      payload: event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? event.payload
        : undefined,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}
