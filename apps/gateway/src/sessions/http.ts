import type { SessionActor } from "./SessionActor.js";
import type { SessionManager } from "./SessionManager.js";
import type { AgentProcessManager } from "../agents/agent-process-manager.js";

interface StartSessionBody {
  userId?: unknown;
  sessionId?: unknown;
  initialPrompt?: unknown;
}

interface SendSessionBody {
  userId?: unknown;
  sessionId?: unknown;
  message?: unknown;
}

interface StartSessionDeps {
  sessionManager: SessionManager;
  agentProcessManager?: Pick<AgentProcessManager, "isManaging">;
  startAgentForSession: (
    actor: SessionActor,
    userId: string,
    initialPrompt?: string,
  ) => Promise<void>;
}

interface SendSessionDeps {
  sessionManager: SessionManager;
  agentProcessManager: AgentProcessManager;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }

  return value;
}

async function loadOwnedSession(
  sessionManager: SessionManager,
  userId: string,
  sessionId: string,
): Promise<SessionActor> {
  const actor =
    sessionManager.getSession(sessionId) ??
    (await sessionManager.getOrLoadSession(sessionId));

  if (!actor) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (actor.userId !== userId) {
    throw new Error(`Session ${sessionId} does not belong to user ${userId}`);
  }

  return actor;
}

export async function startSessionFromHttp(
  body: StartSessionBody,
  deps: StartSessionDeps,
): Promise<{ sessionId: string; status: string }> {
  const userId = requireString(body.userId, "userId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const initialPrompt =
    typeof body.initialPrompt === "string" ? body.initialPrompt : undefined;

  const actor = await loadOwnedSession(deps.sessionManager, userId, sessionId);

  if (
    actor.getStatus() === "running" &&
    deps.agentProcessManager?.isManaging(actor.sessionId) !== false
  ) {
    return { sessionId: actor.sessionId, status: actor.getStatus() };
  }

  actor.setStatus("provisioning");
  await deps.startAgentForSession(actor, userId, initialPrompt);

  return { sessionId: actor.sessionId, status: actor.getStatus() };
}

export async function sendSessionMessageFromHttp(
  body: SendSessionBody,
  deps: SendSessionDeps,
): Promise<{ sessionId: string; acceptedSeq: number; delivered: boolean }> {
  const userId = requireString(body.userId, "userId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const message = requireString(body.message, "message");

  const actor = await loadOwnedSession(deps.sessionManager, userId, sessionId);
  if (!deps.agentProcessManager.isManaging(sessionId)) {
    throw new Error(
      `Session ${sessionId} is not attached to a stdio agent process`,
    );
  }
  const acceptedSeq = actor.handleInput(message, `http-${crypto.randomUUID()}`);
  const delivered = deps.agentProcessManager.sendInput(sessionId, message);

  if (!delivered) {
    throw new Error(`Failed to forward input to session ${sessionId}`);
  }

  return { sessionId: actor.sessionId, acceptedSeq, delivered };
}
