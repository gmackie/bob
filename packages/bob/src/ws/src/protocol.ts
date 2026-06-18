// Shared WebSocket protocol types for client and server.
// This is the single source of truth — both gateway and clients import from here.

export type SessionStatus = "provisioning" | "starting" | "running" | "idle" | "stopping" | "stopped" | "completed" | "failed" | "error";
export type DeviceType = "web" | "ios" | "android" | "desktop" | "daemon" | "other";
export type EventDirection = "client" | "agent" | "system";
export type SessionEventType =
  | "output_chunk"
  | "message_final"
  | "input"
  | "tool_call"
  | "tool_result"
  | "state"
  | "error"
  | "heartbeat";

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

export interface ClientHello {
  type: "hello";
  clientId: string;
  deviceType: DeviceType;
  token: string;
  lastGlobalSeenAt?: string;
  /** Required when deviceType === "daemon" */
  workspaceId?: string;
}

export interface ClientSubscribe {
  type: "subscribe";
  sessionId: string;
  lastAckSeq: number;
  /** When true, skip auto-starting the agent — observe only (mission control) */
  observe?: boolean;
}

export interface ClientUnsubscribe {
  type: "unsubscribe";
  sessionId: string;
}

export interface ClientInput {
  type: "input";
  sessionId: string;
  clientInputId: string;
  data: string;
}

export interface ClientAck {
  type: "ack";
  sessionId: string;
  seq: number;
}

export interface ClientPing {
  type: "ping";
  ts: string;
}

export interface ClientCreateSession {
  type: "create_session";
  sessionId?: string;
  worktreeId?: string;
  repositoryId?: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  cookieDomains?: string[];
}

export interface ClientStopSession {
  type: "stop_session";
  sessionId: string;
}

/** Daemon announces it has accepted a session_available nudge */
export interface ClientSessionClaimed {
  type: "session_claimed";
  sessionId: string;
}

/** Daemon reports an event from the running agent */
export interface ClientSessionEvent {
  type: "session_event";
  sessionId: string;
  eventType: SessionEventType;
  direction: EventDirection;
  payload: Record<string, unknown>;
}

/** Daemon reports a session lifecycle change */
export interface ClientSessionStatus {
  type: "session_status";
  sessionId: string;
  status: SessionStatus;
}

export interface ClientSubscribeWorkspace {
  type: "subscribe_workspace";
  statusFilter?: SessionStatus[];
}

export interface ClientUnsubscribeWorkspace {
  type: "unsubscribe_workspace";
}

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

export interface ServerHelloOk {
  type: "hello_ok";
  gatewayTime: string;
  heartbeatIntervalMs: number;
  userId: string;
}

export interface ServerSubscribed {
  type: "subscribed";
  sessionId: string;
  currentState: SessionStatus;
  latestSeq: number;
}

export interface ServerUnsubscribed {
  type: "unsubscribed";
  sessionId: string;
}

export interface ServerInputAck {
  type: "input_ack";
  sessionId: string;
  clientInputId: string;
  acceptedSeq: number;
}

export interface ServerEvent {
  type: "event";
  sessionId: string;
  seq: number;
  eventType: SessionEventType;
  direction: EventDirection;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ServerPong {
  type: "pong";
  ts: string;
}

export interface ServerError {
  type: "error";
  code: string;
  message: string;
  sessionId?: string;
  retryable: boolean;
}

export interface ServerSessionCreated {
  type: "session_created";
  sessionId: string;
  status: SessionStatus;
}

export interface ServerSessionStopped {
  type: "session_stopped";
  sessionId: string;
}

export interface WorkspaceSessionInfo {
  sessionId: string;
  status: SessionStatus;
  title?: string;
  agentType: string;
  lastActivityAt: string;
}

export interface ServerWorkspaceSnapshot {
  type: "workspace_snapshot";
  sessions: WorkspaceSessionInfo[];
}

export interface ServerSessionStatusChanged {
  type: "session_status_changed";
  sessionId: string;
  status: SessionStatus;
  title?: string;
  agentType?: string;
}

export interface PlanningLaunchContext {
  intent: "shape" | "breakdown";
  notes: string;
  workItem?: {
    id: string;
    identifier: string;
    title: string;
    kind: string;
  };
  selectedRepoSources: Array<{
    id: string;
    label: string;
    path: string;
    detail: string;
  }>;
  attachedFiles: Array<{
    name: string;
    sizeLabel: string;
    content?: string;
  }>;
}

export interface PlanningContext {
  workspaceId: string;
  projectId: string;
  projectName: string;
  launchContext?: PlanningLaunchContext;
}

/** Gateway nudges a daemon that a new session is pending */
export interface ServerSessionAvailable {
  type: "session_available";
  sessionId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  sessionType?: "execution" | "planning";
  planningContext?: PlanningContext;
  /** Execution context — gives the agent enough info to start working */
  description?: string;
  identifier?: string;
  branch?: string;
  /** Persona-based session config */
  personaId?: string;
  personaConfig?: {
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    metadata?: Record<string, unknown>;
  };
}

/** Gateway tells the browser it exceeded the replay window */
export interface ServerReplayTruncated {
  type: "replay_truncated";
  sessionId: string;
  oldestAvailableSeq: number;
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type ClientMessage =
  | ClientHello
  | ClientSubscribe
  | ClientUnsubscribe
  | ClientInput
  | ClientAck
  | ClientPing
  | ClientCreateSession
  | ClientStopSession
  | ClientSessionClaimed
  | ClientSessionEvent
  | ClientSessionStatus
  | ClientSubscribeWorkspace
  | ClientUnsubscribeWorkspace;

export type ServerMessage =
  | ServerHelloOk
  | ServerSubscribed
  | ServerUnsubscribed
  | ServerInputAck
  | ServerEvent
  | ServerPong
  | ServerError
  | ServerSessionCreated
  | ServerSessionStopped
  | ServerWorkspaceSnapshot
  | ServerSessionStatusChanged
  | ServerSessionAvailable
  | ServerReplayTruncated;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface SessionEventPayload {
  outputChunk: { data: string; stream: "stdout" | "stderr" };
  messageFinal: { content: string; role: string };
  input: { data: string; clientInputId: string };
  toolCall: { toolCallId: string; name: string; arguments: string };
  toolResult: { toolCallId: string; result: string; isError: boolean };
  state: { status: SessionStatus; reason?: string };
  error: { code: string; message: string };
  heartbeat: { ts: string };
}

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const msg = JSON.parse(data) as ServerMessage;
    if (!msg || typeof msg !== "object" || !msg.type) {
      return null;
    }
    return msg;
  } catch {
    return null;
  }
}

export function encodeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

// Server-side codec (used by the gateway)

export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const msg = JSON.parse(data) as ClientMessage;
    if (!msg || typeof msg !== "object" || !msg.type) {
      return null;
    }
    return msg;
  } catch {
    return null;
  }
}

export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function createError(
  code: string,
  message: string,
  sessionId?: string,
  retryable = false,
): ServerError {
  return { type: "error", code, message, sessionId, retryable };
}
