export type SessionStatus = "provisioning" | "starting" | "running" | "idle" | "stopping" | "stopped" | "error";
export type DeviceType = "web" | "ios" | "android" | "desktop" | "other";
export type EventDirection = "client" | "agent" | "system";
export type SessionEventType = "output_chunk" | "message_final" | "input" | "tool_call" | "tool_result" | "state" | "error" | "heartbeat";

export interface ClientHello {
  type: "hello";
  clientId: string;
  deviceType: DeviceType;
  token: string;
  lastGlobalSeenAt?: string;
}

export interface ServerHelloOk {
  type: "hello_ok";
  gatewayTime: string;
  heartbeatIntervalMs: number;
  userId: string;
}

export interface ClientSubscribe {
  type: "subscribe";
  sessionId: string;
  lastAckSeq: number;
}

export interface ServerSubscribed {
  type: "subscribed";
  sessionId: string;
  currentState: SessionStatus;
  latestSeq: number;
}

export interface ClientUnsubscribe {
  type: "unsubscribe";
  sessionId: string;
}

export interface ServerUnsubscribed {
  type: "unsubscribed";
  sessionId: string;
}

export interface ClientInput {
  type: "input";
  sessionId: string;
  clientInputId: string;
  data: string;
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

export interface ClientAck {
  type: "ack";
  sessionId: string;
  seq: number;
}

export interface ClientPing {
  type: "ping";
  ts: string;
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

export interface ClientCreateSession {
  type: "create_session";
  worktreeId?: string;
  repositoryId?: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
}

export interface ServerSessionCreated {
  type: "session_created";
  sessionId: string;
  status: SessionStatus;
}

export interface ClientStopSession {
  type: "stop_session";
  sessionId: string;
}

export interface ServerSessionStopped {
  type: "session_stopped";
  sessionId: string;
}

export type ClientMessage =
  | ClientHello
  | ClientSubscribe
  | ClientUnsubscribe
  | ClientInput
  | ClientAck
  | ClientPing
  | ClientCreateSession
  | ClientStopSession;

export type ServerMessage =
  | ServerHelloOk
  | ServerSubscribed
  | ServerUnsubscribed
  | ServerInputAck
  | ServerEvent
  | ServerPong
  | ServerError
  | ServerSessionCreated
  | ServerSessionStopped;

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

export function createEvent(
  sessionId: string,
  seq: number,
  eventType: SessionEventType,
  direction: EventDirection,
  payload: Record<string, unknown>
): ServerEvent {
  return {
    type: "event",
    sessionId,
    seq,
    eventType,
    direction,
    payload,
    createdAt: new Date().toISOString(),
  };
}

export function createError(code: string, message: string, sessionId?: string, retryable = false): ServerError {
  return {
    type: "error",
    code,
    message,
    sessionId,
    retryable,
  };
}
