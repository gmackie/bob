import { WebSocket } from "ws";
import type { SessionStatus, ServerEvent, EventDirection, SessionEventType } from "../ws/protocol.js";
import { createEvent, encodeServerMessage } from "../ws/protocol.js";

export interface SessionConfig {
  sessionId: string;
  userId: string;
  agentType: string;
  workingDirectory: string;
  worktreeId?: string;
  repositoryId?: string;
}

export interface SubscriberConnection {
  ws: WebSocket;
  clientId: string;
  lastAckSeq: number;
  subscribedAt: Date;
}

export interface PersistenceCallback {
  (event: {
    sessionId: string;
    seq: number;
    direction: EventDirection;
    eventType: SessionEventType;
    payload: Record<string, unknown>;
  }): void;
}

export class SessionActor {
  readonly sessionId: string;
  readonly userId: string;
  readonly agentType: string;
  readonly workingDirectory: string;
  readonly worktreeId?: string;
  readonly repositoryId?: string;

  private status: SessionStatus = "stopped";
  private nextSeq = 1;
  private subscribers = new Map<string, SubscriberConnection>();
  private recentEvents: ServerEvent[] = [];
  private readonly maxRecentEvents = 1000;
  
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleTimeoutMs = 30 * 60 * 1000;

  private onPersist: PersistenceCallback | null = null;
  private onStatusChange: ((status: SessionStatus) => void) | null = null;

  constructor(config: SessionConfig) {
    this.sessionId = config.sessionId;
    this.userId = config.userId;
    this.agentType = config.agentType;
    this.workingDirectory = config.workingDirectory;
    this.worktreeId = config.worktreeId;
    this.repositoryId = config.repositoryId;
  }

  setPersistenceCallback(cb: PersistenceCallback): void {
    this.onPersist = cb;
  }

  setStatusChangeCallback(cb: (status: SessionStatus) => void): void {
    this.onStatusChange = cb;
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  getLatestSeq(): number {
    return this.nextSeq - 1;
  }

  setStatus(status: SessionStatus, reason?: string): void {
    const oldStatus = this.status;
    this.status = status;

    if (oldStatus !== status) {
      const event = this.emitEvent("system", "state", { status, reason, previousStatus: oldStatus });
      this.broadcastToSubscribers(event);
      this.onStatusChange?.(status);
    }

    this.resetIdleTimer();
  }

  attachSubscriber(clientId: string, ws: WebSocket, lastAckSeq: number): ServerEvent[] {
    this.subscribers.set(clientId, {
      ws,
      clientId,
      lastAckSeq,
      subscribedAt: new Date(),
    });

    this.resetIdleTimer();

    if (this.status === "idle") {
      this.setStatus("running", "subscriber_attached");
    }

    const missedEvents = this.recentEvents.filter((e) => e.seq > lastAckSeq);
    return missedEvents;
  }

  detachSubscriber(clientId: string): void {
    this.subscribers.delete(clientId);

    if (this.subscribers.size === 0 && this.status === "running") {
      this.startIdleTimer();
    }
  }

  updateAck(clientId: string, seq: number): void {
    const sub = this.subscribers.get(clientId);
    if (sub && seq > sub.lastAckSeq) {
      sub.lastAckSeq = seq;
    }
  }

  handleInput(data: string, clientInputId: string): number {
    const seq = this.emitEvent("client", "input", { data, clientInputId }).seq;
    return seq;
  }

  handleAgentOutput(data: string, stream: "stdout" | "stderr" = "stdout"): void {
    const event = this.emitEvent("agent", "output_chunk", { data, stream });
    this.broadcastToSubscribers(event);
  }

  handleToolCall(toolCallId: string, name: string, args: string): void {
    const event = this.emitEvent("agent", "tool_call", { toolCallId, name, arguments: args });
    this.broadcastToSubscribers(event);
  }

  handleToolResult(toolCallId: string, result: string, isError: boolean): void {
    const event = this.emitEvent("agent", "tool_result", { toolCallId, result, isError });
    this.broadcastToSubscribers(event);
  }

  handleAgentExit(code: number | null, signal: string | null): void {
    const reason = signal ? `signal_${signal}` : code !== 0 ? `exit_code_${code}` : "normal_exit";
    this.setStatus(code === 0 ? "stopped" : "error", reason);
  }

  private emitEvent(direction: EventDirection, eventType: SessionEventType, payload: Record<string, unknown>): ServerEvent {
    const seq = this.nextSeq++;
    const event = createEvent(this.sessionId, seq, eventType, direction, payload);

    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.shift();
    }

    this.onPersist?.({
      sessionId: this.sessionId,
      seq,
      direction,
      eventType,
      payload,
    });

    return event;
  }

  private broadcastToSubscribers(event: ServerEvent): void {
    const message = encodeServerMessage(event);
    for (const sub of this.subscribers.values()) {
      if (sub.ws.readyState === WebSocket.OPEN) {
        sub.ws.send(message);
      }
    }
  }

  private startIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.subscribers.size === 0 && this.status === "running") {
        this.setStatus("idle", "no_subscribers_timeout");
      }
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private resetIdleTimer(): void {
    if (this.subscribers.size === 0) {
      this.startIdleTimer();
    } else {
      this.clearIdleTimer();
    }
  }

  destroy(): void {
    this.clearIdleTimer();
    for (const sub of this.subscribers.values()) {
      sub.ws.close();
    }
    this.subscribers.clear();
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  getInfo(): {
    sessionId: string;
    userId: string;
    status: SessionStatus;
    latestSeq: number;
    subscriberCount: number;
    recentEventCount: number;
  } {
    return {
      sessionId: this.sessionId,
      userId: this.userId,
      status: this.status,
      latestSeq: this.getLatestSeq(),
      subscriberCount: this.subscribers.size,
      recentEventCount: this.recentEvents.length,
    };
  }
}
