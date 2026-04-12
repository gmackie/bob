import type {
  ClientCreateSession,
  ClientMessage,
  DeviceType,
  ServerError,
  ServerEvent,
  ServerMessage,
  ServerSessionStatusChanged,
  SessionStatus,
  WorkspaceSessionInfo,
} from "./protocol.js";
import { encodeClientMessage, parseServerMessage } from "./protocol.js";

// ---------------------------------------------------------------------------
// Minimal WebSocket interface — works with browser, Node, and React Native
// ---------------------------------------------------------------------------

export interface IWebSocket {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface IWebSocketConstructor {
  new (url: string): IWebSocket;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface BobWsClientOptions {
  url: string;
  token: string;
  clientId: string;
  deviceType: DeviceType;
  onEvent: (sessionId: string, event: ServerEvent) => void;
  onSessionStatus: (sessionId: string, status: SessionStatus) => void;
  onWorkspaceSnapshot?: (sessions: WorkspaceSessionInfo[]) => void;
  onSessionStatusChanged?: (info: ServerSessionStatusChanged) => void;
  onError: (error: ServerError) => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  /** Override WebSocket constructor for React Native or testing. */
  WebSocketImpl?: IWebSocketConstructor;
}

// ---------------------------------------------------------------------------
// Internal subscription tracking
// ---------------------------------------------------------------------------

interface SessionSubscription {
  sessionId: string;
  lastAckSeq: number;
}

interface WorkspaceSubscription {
  statusFilter?: SessionStatus[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const HEARTBEAT_INTERVAL_MULTIPLIER = 0.8; // send ping at 80% of server interval
const DEFAULT_HEARTBEAT_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class BobWsClient {
  private opts: BobWsClientOptions;
  private ws: IWebSocket | null = null;
  private _state: ConnectionState = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS;
  private intentionalClose = false;

  // Subscription tracking for auto-resubscribe on reconnect
  private sessionSubs = new Map<string, SessionSubscription>();
  private workspaceSub: WorkspaceSubscription | null = null;

  private inputCounter = 0;

  constructor(options: BobWsClientOptions) {
    this.opts = options;
  }

  // -- public API -----------------------------------------------------------

  get state(): ConnectionState {
    return this._state;
  }

  connect(): void {
    if (this._state === "connected" || this._state === "connecting") return;
    this.intentionalClose = false;
    this.doConnect();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
    this.setState("disconnected");
  }

  subscribe(sessionId: string, lastAckSeq = 0): void {
    this.sessionSubs.set(sessionId, { sessionId, lastAckSeq });
    this.send({ type: "subscribe", sessionId, lastAckSeq });
  }

  unsubscribe(sessionId: string): void {
    this.sessionSubs.delete(sessionId);
    this.send({ type: "unsubscribe", sessionId });
  }

  subscribeWorkspace(statusFilter?: SessionStatus[]): void {
    this.workspaceSub = { statusFilter };
    this.send({ type: "subscribe_workspace", statusFilter });
  }

  unsubscribeWorkspace(): void {
    this.workspaceSub = null;
    this.send({ type: "unsubscribe_workspace" });
  }

  sendInput(sessionId: string, data: string): string {
    const clientInputId = `${this.opts.clientId}-${++this.inputCounter}`;
    this.send({ type: "input", sessionId, clientInputId, data });
    return clientInputId;
  }

  createSession(config: Omit<ClientCreateSession, "type">): void {
    this.send({ type: "create_session", ...config });
  }

  stopSession(sessionId: string): void {
    this.send({ type: "stop_session", sessionId });
  }

  // -- connection lifecycle -------------------------------------------------

  private doConnect(): void {
    this.setState(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");

    const WS = this.opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as IWebSocketConstructor);
    const ws = new WS(this.opts.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      // Authenticate immediately
      this.send({
        type: "hello",
        clientId: this.opts.clientId,
        deviceType: this.opts.deviceType,
        token: this.opts.token,
      });
    };

    ws.onmessage = (ev: { data: unknown }) => {
      const msg = parseServerMessage(typeof ev.data === "string" ? ev.data : String(ev.data));
      if (!msg) return;
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      this.clearTimers();
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror — reconnect handled there
    };
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "hello_ok":
        this.heartbeatIntervalMs = msg.heartbeatIntervalMs || DEFAULT_HEARTBEAT_MS;
        this.setState("connected");
        this.startHeartbeat();
        this.resubscribeAll();
        break;

      case "pong":
        this.clearPongTimeout();
        break;

      case "event":
        // Track the latest seq for resubscription
        {
          const sub = this.sessionSubs.get(msg.sessionId);
          if (sub) sub.lastAckSeq = msg.seq;
        }
        this.opts.onEvent(msg.sessionId, msg);
        break;

      case "subscribed":
        this.opts.onSessionStatus(msg.sessionId, msg.currentState);
        break;

      case "session_created":
        this.opts.onSessionStatus(msg.sessionId, msg.status);
        break;

      case "session_stopped":
        this.opts.onSessionStatus(msg.sessionId, "stopped");
        break;

      case "error":
        this.opts.onError(msg);
        break;

      case "workspace_snapshot":
        this.opts.onWorkspaceSnapshot?.(msg.sessions);
        break;

      case "session_status_changed":
        this.opts.onSessionStatusChanged?.(msg);
        break;

      case "input_ack":
      case "unsubscribed":
      case "session_available":
      case "replay_truncated":
        // Informational — no action needed on browser client
        break;
    }
  }

  // -- heartbeat ------------------------------------------------------------

  private startHeartbeat(): void {
    this.clearTimers();
    const interval = this.heartbeatIntervalMs * HEARTBEAT_INTERVAL_MULTIPLIER;
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping", ts: new Date().toISOString() });
      this.pongTimer = setTimeout(() => {
        // No pong received — assume dead connection
        this.ws?.close();
      }, PONG_TIMEOUT_MS);
    }, interval);
  }

  private clearPongTimeout(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  // -- reconnect ------------------------------------------------------------

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    const delay = Math.min(
      MIN_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }

  private resubscribeAll(): void {
    for (const sub of this.sessionSubs.values()) {
      this.send({ type: "subscribe", sessionId: sub.sessionId, lastAckSeq: sub.lastAckSeq });
    }
    if (this.workspaceSub) {
      this.send({ type: "subscribe_workspace", statusFilter: this.workspaceSub.statusFilter });
    }
  }

  // -- helpers --------------------------------------------------------------

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(encodeClientMessage(msg));
    }
  }

  private setState(s: ConnectionState): void {
    if (s !== this._state) {
      this._state = s;
      this.opts.onConnectionStateChange(s);
    }
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimeout();
  }

  private cleanup(): void {
    this.clearTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
