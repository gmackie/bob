// ============================================================================
// Shared types
// ============================================================================

export type SessionStatus =
  | "provisioning"
  | "starting"
  | "running"
  | "idle"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed"
  | "error";

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

// ============================================================================
// Client → Gateway messages
// ============================================================================

export interface ClientHello {
  type: "hello";
  clientId: string;
  deviceType: DeviceType;
  token: string;
  /** Required when deviceType === "daemon" */
  workspaceId?: string;
}

export interface ClientSubscribe {
  type: "subscribe";
  sessionId: string;
  lastAckSeq: number;
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

/** Browser subscribes to all sessions for their user (tablet mission control) */
export interface ClientSubscribeWorkspace {
  type: "subscribe_workspace";
  statusFilter?: SessionStatus[];
}

export interface ClientUnsubscribeWorkspace {
  type: "unsubscribe_workspace";
}

export type ClientMessage =
  | ClientHello
  | ClientSubscribe
  | ClientUnsubscribe
  | ClientInput
  | ClientAck
  | ClientPing
  | ClientSessionClaimed
  | ClientSessionEvent
  | ClientSessionStatus
  | ClientSubscribeWorkspace
  | ClientUnsubscribeWorkspace;

// ============================================================================
// Gateway → Client messages
// ============================================================================

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

/** Gateway nudges a daemon that a new session is pending */
export interface ServerSessionAvailable {
  type: "session_available";
  sessionId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
}

/** Gateway tells subscribers the session's live status changed */
export interface ServerSessionStatusChanged {
  type: "session_status_changed";
  sessionId: string;
  status: SessionStatus;
}

/** Gateway tells the browser it exceeded the replay window */
export interface ServerReplayTruncated {
  type: "replay_truncated";
  sessionId: string;
  oldestAvailableSeq: number;
}

export interface WorkspaceSessionInfo {
  sessionId: string;
  status: SessionStatus;
  agentType: string;
  title?: string;
  lastActivityAt: string;
}

/** All sessions for the user (response to subscribe_workspace) */
export interface ServerWorkspaceSnapshot {
  type: "workspace_snapshot";
  sessions: WorkspaceSessionInfo[];
}

export type ServerMessage =
  | ServerHelloOk
  | ServerSubscribed
  | ServerUnsubscribed
  | ServerInputAck
  | ServerEvent
  | ServerPong
  | ServerError
  | ServerSessionAvailable
  | ServerSessionStatusChanged
  | ServerReplayTruncated
  | ServerWorkspaceSnapshot;

// ============================================================================
// Codec
// ============================================================================

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
