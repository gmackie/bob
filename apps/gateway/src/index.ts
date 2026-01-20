import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { spawn, execSync } from "child_process";
import { promises as fs } from "fs";
import { join, dirname, basename } from "path";
import { SessionManager, SessionRecord, SessionManagerCallbacks } from "./sessions/SessionManager.js";
import { SessionConfig } from "./sessions/SessionActor.js";
import { PersistenceWriter, SessionEventRecord } from "./persistence/PersistenceWriter.js";
import { SessionCleanup } from "./sessions/SessionCleanup.js";
import {
  parseClientMessage,
  encodeServerMessage,
  createError,
  createEvent,
  ClientMessage as SessionClientMessage,
  ServerMessage,
  SessionStatus,
  DeviceType,
  ClientHello,
  ClientSubscribe,
  ClientUnsubscribe,
  ClientInput,
  ClientAck,
  ClientCreateSession,
  ClientStopSession,
} from "./ws/protocol.js";

const PORT = parseInt(process.env.GATEWAY_PORT ?? "3002", 10);
const GATEWAY_ID = process.env.GATEWAY_ID ?? `gateway-${crypto.randomUUID().slice(0, 8)}`;
const CONTAINER_TTL_MS = 48 * 60 * 60 * 1000;
const CONTAINER_IMAGE = process.env.AGENT_IMAGE ?? "bob-agent:latest";
const CONTAINER_PORT = 3100;
const HEARTBEAT_INTERVAL_MS = 30_000;

interface UserContainer {
  userId: string;
  containerId: string;
  containerPort: number;
  lastActivity: Date;
  status: "starting" | "running" | "stopping" | "stopped";
}

interface ProxySession {
  id: string;
  userId: string;
  agentWs: WebSocket | null;
  clientWs: WebSocket;
  agentType: string;
}

type EventType =
  | "instance.started" | "instance.stopped" | "instance.error"
  | "git.commit" | "git.push" | "git.pull" | "git.checkout"
  | "file.created" | "file.modified" | "file.deleted"
  | "plan.created" | "plan.updated" | "plan.task_completed"
  | "chat.message" | "chat.tool_call" | "chat.tool_result"
  | "worktree.created" | "worktree.deleted"
  | "link.created" | "link.removed";

interface GatewayEvent {
  id: string;
  type: EventType;
  userId: string;
  worktreeId?: string;
  repositoryId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

interface EventSubscription {
  id: string;
  userId: string;
  ws: WebSocket;
  worktreeIds: Set<string>;
  eventTypes: Set<EventType>;
  lastAck?: string;
}

interface LegacyClientMessage {
  type: "hello" | "subscribe" | "unsubscribe" | "ack" | "ping";
  userId?: string;
  worktreeIds?: string[];
  eventTypes?: EventType[];
  eventId?: string;
}

interface SessionConnection {
  ws: WebSocket;
  clientId: string;
  deviceType: DeviceType;
  userId: string | null;
  authenticated: boolean;
  subscribedSessions: Set<string>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

const userContainers = new Map<string, UserContainer>();
const proxySessions = new Map<string, ProxySession>();
const eventSubscriptions = new Map<string, EventSubscription>();
const sessionConnections = new Map<string, SessionConnection>();

let nextPort = 31000;

const persistenceWriter = new PersistenceWriter({
  batchSize: 50,
  flushIntervalMs: 100,
  onBatchWrite: async (events: SessionEventRecord[]) => {
    console.log(`[Gateway] Persisting ${events.length} session events (TODO: write to DB)`);
  },
  onError: (error, events) => {
    console.error(`[Gateway] Failed to persist ${events.length} events:`, error);
  },
});

const sessionManager = new SessionManager({
  gatewayId: GATEWAY_ID,
  leaseTimeoutMs: 30_000,
  cleanupIntervalMs: 10_000,
});

const sessionManagerCallbacks: SessionManagerCallbacks = {
  onPersistEvent: (event) => {
    persistenceWriter.enqueue(event);
  },
  onSessionStatusChange: async (sessionId, status) => {
    console.log(`[Gateway] Session ${sessionId} status changed to ${status}`);
  },
  loadSession: async (sessionId): Promise<SessionRecord | null> => {
    console.log(`[Gateway] Loading session ${sessionId} (TODO: from DB)`);
    return null;
  },
  createSession: async (config): Promise<SessionRecord> => {
    const id = generateId();
    console.log(`[Gateway] Creating session ${id} (TODO: persist to DB)`);
    return {
      id,
      userId: config.userId,
      status: "provisioning",
      agentType: config.agentType,
      workingDirectory: config.workingDirectory,
      worktreeId: config.worktreeId,
      repositoryId: config.repositoryId,
      nextSeq: 1,
    };
  },
  updateSessionLease: async (sessionId, gatewayId, expiresAt) => {
    console.log(`[Gateway] Updating lease for session ${sessionId}`);
  },
  releaseSessionLease: async (sessionId) => {
    console.log(`[Gateway] Releasing lease for session ${sessionId}`);
  },
};

sessionManager.setCallbacks(sessionManagerCallbacks);

const sessionCleanup = new SessionCleanup(sessionManager, {
  idleTimeoutMs: 30 * 60 * 1000,
  staleLeaseTimeoutMs: 60 * 1000,
  maxSessionAgeMs: 7 * 24 * 60 * 60 * 1000,
  cleanupIntervalMs: 60 * 1000,
});

sessionCleanup.setCallbacks({
  getStaleSessionIds: async (leaseExpiredBefore) => {
    console.log(`[SessionCleanup] Getting stale sessions (lease expired before ${leaseExpiredBefore.toISOString()})`);
    return [];
  },
  getIdleSessions: async (idleSince) => {
    console.log(`[SessionCleanup] Getting idle sessions (idle since ${idleSince.toISOString()})`);
    return [];
  },
  getOldSessions: async (createdBefore) => {
    console.log(`[SessionCleanup] Getting old sessions (created before ${createdBefore.toISOString()})`);
    return [];
  },
  markSessionStopped: async (sessionId) => {
    console.log(`[SessionCleanup] Marking session ${sessionId} as stopped`);
  },
  deleteOldEvents: async (sessionId, keepAfterSeq) => {
    console.log(`[SessionCleanup] Deleting old events for session ${sessionId} (keeping after seq ${keepAfterSeq})`);
    return 0;
  },
});

function generateId(): string {
  return crypto.randomUUID();
}

function broadcastEvent(event: GatewayEvent): void {
  for (const sub of eventSubscriptions.values()) {
    if (sub.userId !== event.userId) continue;

    const matchesWorktree = !event.worktreeId || 
      sub.worktreeIds.size === 0 || 
      sub.worktreeIds.has(event.worktreeId);
    
    const matchesType = sub.eventTypes.size === 0 || 
      sub.eventTypes.has(event.type);

    if (matchesWorktree && matchesType) {
      if (sub.ws.readyState === WebSocket.OPEN) {
        sub.ws.send(JSON.stringify({ type: "event", event }));
      }
    }
  }
}

function publishEvent(
  userId: string,
  eventType: EventType,
  payload: Record<string, unknown>,
  worktreeId?: string,
  repositoryId?: string
): GatewayEvent {
  const event: GatewayEvent = {
    id: generateId(),
    type: eventType,
    userId,
    worktreeId,
    repositoryId,
    payload,
    timestamp: new Date().toISOString(),
  };

  broadcastEvent(event);
  console.log(`[Gateway] Event ${eventType} published for user ${userId}`);
  return event;
}

function handleEventSubscription(ws: WebSocket, message: LegacyClientMessage, subId: string): void {
  const sub = eventSubscriptions.get(subId);
  if (!sub) return;

  switch (message.type) {
    case "subscribe":
      if (message.worktreeIds) {
        for (const id of message.worktreeIds) {
          sub.worktreeIds.add(id);
        }
      }
      if (message.eventTypes) {
        for (const t of message.eventTypes) {
          sub.eventTypes.add(t);
        }
      }
      ws.send(JSON.stringify({ 
        type: "subscribed", 
        worktreeIds: Array.from(sub.worktreeIds),
        eventTypes: Array.from(sub.eventTypes),
      }));
      break;

    case "unsubscribe":
      if (message.worktreeIds) {
        for (const id of message.worktreeIds) {
          sub.worktreeIds.delete(id);
        }
      }
      if (message.eventTypes) {
        for (const t of message.eventTypes) {
          sub.eventTypes.delete(t);
        }
      }
      ws.send(JSON.stringify({ 
        type: "unsubscribed",
        worktreeIds: Array.from(sub.worktreeIds),
        eventTypes: Array.from(sub.eventTypes),
      }));
      break;

    case "ack":
      if (message.eventId) {
        sub.lastAck = message.eventId;
      }
      break;

    case "ping":
      ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
      break;
  }
}

// ============================================================================
// HTTP Request Helpers
// ============================================================================

async function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

// ============================================================================
// Filesystem Operations
// ============================================================================

async function handleFsList(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const showHidden = body.showHidden as boolean ?? false;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    const dirents = await fs.readdir(path, { withFileTypes: true });
    const entries = await Promise.all(
      dirents
        .filter((d) => showHidden || !d.name.startsWith("."))
        .map(async (d) => {
          const fullPath = join(path, d.name);
          try {
            const stats = await fs.stat(fullPath);
            return {
              name: d.name,
              path: fullPath,
              isDirectory: d.isDirectory(),
              isFile: d.isFile(),
              size: stats.size,
              modified: stats.mtime.toISOString(),
            };
          } catch {
            return {
              name: d.name,
              path: fullPath,
              isDirectory: d.isDirectory(),
              isFile: d.isFile(),
              size: 0,
              modified: new Date().toISOString(),
            };
          }
        })
    );

    sendJson(res, 200, { entries });
  } catch (error) {
    sendError(res, 500, `Failed to list directory: ${error}`);
  }
}

async function handleFsRead(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const encoding = (body.encoding as string) ?? "utf-8";

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    const stats = await fs.stat(path);
    const buffer = await fs.readFile(path);
    const content = encoding === "base64" ? buffer.toString("base64") : buffer.toString("utf-8");

    sendJson(res, 200, { content, size: stats.size });
  } catch (error) {
    sendError(res, 500, `Failed to read file: ${error}`);
  }
}

async function handleFsWrite(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const content = body.content as string;
  const createDirs = body.createDirs as boolean ?? true;

  if (!path || content === undefined) {
    sendError(res, 400, "path and content are required");
    return;
  }

  try {
    if (createDirs) {
      await fs.mkdir(dirname(path), { recursive: true });
    }
    await fs.writeFile(path, content, "utf-8");
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Failed to write file: ${error}`);
  }
}

async function handleFsDelete(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const recursive = body.recursive as boolean ?? false;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    await fs.rm(path, { recursive, force: true });
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Failed to delete: ${error}`);
  }
}

async function handleFsMkdir(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const recursive = body.recursive as boolean ?? true;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    await fs.mkdir(path, { recursive });
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Failed to create directory: ${error}`);
  }
}

async function handleFsMove(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const source = body.source as string;
  const destination = body.destination as string;

  if (!source || !destination) {
    sendError(res, 400, "source and destination are required");
    return;
  }

  try {
    await fs.rename(source, destination);
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Failed to move: ${error}`);
  }
}

async function handleFsCopy(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const source = body.source as string;
  const destination = body.destination as string;

  if (!source || !destination) {
    sendError(res, 400, "source and destination are required");
    return;
  }

  try {
    await fs.cp(source, destination, { recursive: true });
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Failed to copy: ${error}`);
  }
}

async function handleFsSearch(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const pattern = body.pattern as string;
  const maxResults = (body.maxResults as number) ?? 100;

  if (!path || !pattern) {
    sendError(res, 400, "path and pattern are required");
    return;
  }

  try {
    const regex = new RegExp(pattern, "i");
    const matches: string[] = [];

    async function searchDir(dir: string): Promise<void> {
      if (matches.length >= maxResults) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= maxResults) break;
          if (entry.name.startsWith(".")) continue;

          const fullPath = join(dir, entry.name);

          if (regex.test(entry.name)) {
            matches.push(fullPath);
          }

          if (entry.isDirectory()) {
            await searchDir(fullPath);
          }
        }
      } catch {
        // Skip directories we can't access
      }
    }

    await searchDir(path);
    sendJson(res, 200, { matches });
  } catch (error) {
    sendError(res, 500, `Failed to search: ${error}`);
  }
}

// ============================================================================
// Git Operations
// ============================================================================

function runGit(cwd: string, args: string[]): string {
  return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf-8" }).trim();
}

function runGitSafe(cwd: string, args: string[]): string | null {
  try {
    return runGit(cwd, args);
  } catch {
    return null;
  }
}

async function handleGitStatus(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    const branch = runGit(path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    
    // Get ahead/behind counts
    let ahead = 0, behind = 0;
    const upstream = runGitSafe(path, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
    if (upstream) {
      const aheadBehind = runGitSafe(path, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`]);
      if (aheadBehind) {
        const [b, a] = aheadBehind.split("\t").map(Number);
        ahead = a ?? 0;
        behind = b ?? 0;
      }
    }

    // Get status
    const statusOutput = runGit(path, ["status", "--porcelain"]);
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of statusOutput.split("\n").filter(Boolean)) {
      const indexStatus = line[0];
      const workStatus = line[1];
      const file = line.slice(3);

      if (indexStatus === "?") {
        untracked.push(file);
      } else {
        if (indexStatus && indexStatus !== " ") staged.push(file);
        if (workStatus && workStatus !== " ") unstaged.push(file);
      }
    }

    sendJson(res, 200, { branch, ahead, behind, staged, unstaged, untracked });
  } catch (error) {
    sendError(res, 500, `Git status failed: ${error}`);
  }
}

async function handleGitDiff(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const staged = body.staged as boolean ?? false;
  const file = body.file as string | undefined;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    const args = ["diff"];
    if (staged) args.push("--cached");
    if (file) args.push("--", file);

    const diff = runGit(path, args);
    sendJson(res, 200, { diff });
  } catch (error) {
    sendError(res, 500, `Git diff failed: ${error}`);
  }
}

async function handleGitLog(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const limit = (body.limit as number) ?? 20;
  const branch = body.branch as string | undefined;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    const args = [
      "log",
      `--max-count=${limit}`,
      "--format=%H|%h|%s|%an|%aI",
    ];
    if (branch) args.push(branch);

    const output = runGit(path, args);
    const commits = output.split("\n").filter(Boolean).map((line) => {
      const [hash, shortHash, message, author, date] = line.split("|");
      return { hash, shortHash, message, author, date };
    });

    sendJson(res, 200, { commits });
  } catch (error) {
    sendError(res, 500, `Git log failed: ${error}`);
  }
}

async function handleGitBranches(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    const current = runGit(path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const localOutput = runGit(path, ["branch", "--format=%(refname:short)"]);
    const remoteOutput = runGitSafe(path, ["branch", "-r", "--format=%(refname:short)"]) ?? "";

    const local = localOutput.split("\n").filter(Boolean);
    const remote = remoteOutput.split("\n").filter(Boolean);

    sendJson(res, 200, { current, local, remote });
  } catch (error) {
    sendError(res, 500, `Git branches failed: ${error}`);
  }
}

async function handleGitAdd(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const files = (body.files as string[]) ?? [];
  const all = body.all as boolean ?? false;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    if (all) {
      runGit(path, ["add", "-A"]);
    } else if (files.length > 0) {
      runGit(path, ["add", "--", ...files]);
    }
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Git add failed: ${error}`);
  }
}

async function handleGitCommit(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const message = body.message as string;

  if (!path || !message) {
    sendError(res, 400, "path and message are required");
    return;
  }

  try {
    runGit(path, ["commit", "-m", `"${message.replace(/"/g, '\\"')}"`]);
    const hash = runGit(path, ["rev-parse", "HEAD"]);
    sendJson(res, 200, { hash });
  } catch (error) {
    sendError(res, 500, `Git commit failed: ${error}`);
  }
}

async function handleGitPush(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const remote = (body.remote as string) ?? "origin";
  const branch = body.branch as string | undefined;
  const setUpstream = body.setUpstream as boolean ?? false;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    const args = ["push"];
    if (setUpstream) args.push("-u");
    args.push(remote);
    if (branch) args.push(branch);

    runGit(path, args);
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Git push failed: ${error}`);
  }
}

async function handleGitPull(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const remote = (body.remote as string) ?? "origin";
  const branch = body.branch as string | undefined;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    const args = ["pull", remote];
    if (branch) args.push(branch);

    runGit(path, args);
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Git pull failed: ${error}`);
  }
}

async function handleGitCheckout(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const branch = body.branch as string;
  const create = body.create as boolean ?? false;

  if (!path || !branch) {
    sendError(res, 400, "path and branch are required");
    return;
  }

  try {
    const args = ["checkout"];
    if (create) args.push("-b");
    args.push(branch);

    runGit(path, args);
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Git checkout failed: ${error}`);
  }
}

async function handleGitReset(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const files = (body.files as string[]) ?? [];
  const hard = body.hard as boolean ?? false;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    if (files.length > 0) {
      runGit(path, ["reset", "HEAD", "--", ...files]);
    } else if (hard) {
      runGit(path, ["reset", "--hard", "HEAD"]);
    } else {
      runGit(path, ["reset", "HEAD"]);
    }
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Git reset failed: ${error}`);
  }
}

async function handleGitStash(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const path = body.path as string;
  const action = (body.action as string) ?? "push";
  const message = body.message as string | undefined;

  if (!path) {
    sendError(res, 400, "path is required");
    return;
  }

  try {
    switch (action) {
      case "push": {
        const args = ["stash", "push"];
        if (message) args.push("-m", `"${message.replace(/"/g, '\\"')}"`);
        runGit(path, args);
        sendJson(res, 200, { success: true });
        break;
      }
      case "pop": {
        runGit(path, ["stash", "pop"]);
        sendJson(res, 200, { success: true });
        break;
      }
      case "list": {
        const output = runGitSafe(path, ["stash", "list"]) ?? "";
        const stashes = output.split("\n").filter(Boolean);
        sendJson(res, 200, { stashes });
        break;
      }
      case "drop": {
        runGit(path, ["stash", "drop"]);
        sendJson(res, 200, { success: true });
        break;
      }
      default:
        sendError(res, 400, `Unknown stash action: ${action}`);
    }
  } catch (error) {
    sendError(res, 500, `Git stash failed: ${error}`);
  }
}

async function handleGitClone(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
  const url = body.url as string;
  const destination = body.destination as string;
  const branch = body.branch as string | undefined;

  if (!url || !destination) {
    sendError(res, 400, "url and destination are required");
    return;
  }

  try {
    const args = ["clone"];
    if (branch) args.push("-b", branch);
    args.push(url, destination);

    execSync(`git ${args.join(" ")}`, { encoding: "utf-8" });
    sendJson(res, 200, { success: true });
  } catch (error) {
    sendError(res, 500, `Git clone failed: ${error}`);
  }
}

function getContainerName(userId: string): string {
  return `bob-agent-${userId.slice(0, 8)}`;
}

async function ensureContainer(userId: string): Promise<UserContainer> {
  let container = userContainers.get(userId);
  
  if (container && container.status === "running") {
    container.lastActivity = new Date();
    return container;
  }

  const containerName = getContainerName(userId);
  const hostPort = nextPort++;

  console.log(`[Gateway] Starting container for user ${userId}`);

  try {
    execSync(`docker rm -f ${containerName} 2>/dev/null || true`);
    
    const result = execSync(
      `docker run -d --name ${containerName} -p ${hostPort}:${CONTAINER_PORT} ${CONTAINER_IMAGE}`,
      { encoding: "utf-8" }
    );
    
    const containerId = result.trim();

    container = {
      userId,
      containerId,
      containerPort: hostPort,
      lastActivity: new Date(),
      status: "running",
    };

    userContainers.set(userId, container);
    console.log(`[Gateway] Container ${containerName} started on port ${hostPort}`);

    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return container;
  } catch (error) {
    console.error(`[Gateway] Failed to start container:`, error);
    throw error;
  }
}

async function stopContainer(userId: string): Promise<void> {
  const container = userContainers.get(userId);
  if (!container) return;

  container.status = "stopping";
  const containerName = getContainerName(userId);

  console.log(`[Gateway] Stopping container for user ${userId}`);

  try {
    execSync(`docker stop ${containerName}`);
    execSync(`docker rm ${containerName}`);
  } catch (error) {
    console.error(`[Gateway] Failed to stop container:`, error);
  }

  userContainers.delete(userId);
}

function connectToAgentContainer(
  container: UserContainer,
  agentType: string,
  cwd: string
): WebSocket {
  const url = `ws://localhost:${container.containerPort}/?agent=${agentType}&cwd=${encodeURIComponent(cwd)}`;
  return new WebSocket(url);
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, container] of userContainers.entries()) {
    const age = now - container.lastActivity.getTime();
    if (age > CONTAINER_TTL_MS) {
      console.log(`[Gateway] Container for ${userId} expired (TTL)`);
      stopContainer(userId);
    }
  }
}, 60 * 1000);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname === "/health") {
    sendJson(res, 200, { 
      status: "ok",
      gatewayId: GATEWAY_ID,
      containers: userContainers.size,
      legacySessions: proxySessions.size,
      sessionConnections: sessionConnections.size,
      activeSessions: sessionManager.getSessionCount(),
      eventSubscriptions: eventSubscriptions.size,
      persistence: persistenceWriter.getStats(),
    });
    return;
  }

  if (pathname === "/events/publish" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const userId = body.userId as string;
      const eventType = body.eventType as EventType;
      const payload = (body.payload as Record<string, unknown>) ?? {};
      const worktreeId = body.worktreeId as string | undefined;
      const repositoryId = body.repositoryId as string | undefined;

      if (!userId || !eventType) {
        sendError(res, 400, "userId and eventType are required");
        return;
      }

      const event = publishEvent(userId, eventType, payload, worktreeId, repositoryId);
      sendJson(res, 200, { success: true, event });
    } catch (error) {
      sendError(res, 500, String(error));
    }
    return;
  }

  if (pathname === "/containers") {
    const list = Array.from(userContainers.values()).map(c => ({
      userId: c.userId,
      status: c.status,
      port: c.containerPort,
      lastActivity: c.lastActivity.toISOString(),
    }));
    sendJson(res, 200, list);
    return;
  }

  if (pathname === "/sessions/info") {
    sendJson(res, 200, sessionManager.getInfo());
    return;
  }

  if (pathname === "/container/ensure" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const userId = body.userId as string;
      if (!userId) {
        sendError(res, 400, "userId is required");
        return;
      }
      const container = await ensureContainer(userId);
      sendJson(res, 200, { status: "ok", port: container.containerPort });
    } catch (error) {
      sendError(res, 500, String(error));
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const userId = body.userId as string;

      if (userId) {
        const container = userContainers.get(userId);
        if (container) container.lastActivity = new Date();
      }

      switch (pathname) {
        case "/fs/list":
          await handleFsList(body, res);
          return;
        case "/fs/read":
          await handleFsRead(body, res);
          return;
        case "/fs/write":
          await handleFsWrite(body, res);
          return;
        case "/fs/delete":
          await handleFsDelete(body, res);
          return;
        case "/fs/mkdir":
          await handleFsMkdir(body, res);
          return;
        case "/fs/move":
          await handleFsMove(body, res);
          return;
        case "/fs/copy":
          await handleFsCopy(body, res);
          return;
        case "/fs/search":
          await handleFsSearch(body, res);
          return;
        case "/git/status":
          await handleGitStatus(body, res);
          return;
        case "/git/diff":
          await handleGitDiff(body, res);
          return;
        case "/git/log":
          await handleGitLog(body, res);
          return;
        case "/git/branches":
          await handleGitBranches(body, res);
          return;
        case "/git/add":
          await handleGitAdd(body, res);
          return;
        case "/git/commit":
          await handleGitCommit(body, res);
          return;
        case "/git/push":
          await handleGitPush(body, res);
          return;
        case "/git/pull":
          await handleGitPull(body, res);
          return;
        case "/git/checkout":
          await handleGitCheckout(body, res);
          return;
        case "/git/reset":
          await handleGitReset(body, res);
          return;
        case "/git/stash":
          await handleGitStash(body, res);
          return;
        case "/git/clone":
          await handleGitClone(body, res);
          return;
      }
    } catch (error) {
      sendError(res, 500, String(error));
      return;
    }
  }

  sendError(res, 404, "Not Found");
});

function handleSessionsWebSocket(ws: WebSocket): void {
  const connectionId = generateId();
  const connection: SessionConnection = {
    ws,
    clientId: "",
    deviceType: "web",
    userId: null,
    authenticated: false,
    subscribedSessions: new Set(),
    heartbeatTimer: null,
  };
  sessionConnections.set(connectionId, connection);

  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeServerMessage(msg));
    }
  };

  const sendError = (code: string, message: string, sessionId?: string, retryable = false) => {
    send(createError(code, message, sessionId, retryable));
  };

  ws.on("message", async (data) => {
    const msg = parseClientMessage(data.toString());
    if (!msg) {
      sendError("INVALID_MESSAGE", "Failed to parse message");
      return;
    }

    try {
      switch (msg.type) {
        case "hello": {
          const hello = msg as ClientHello;
          connection.clientId = hello.clientId;
          connection.deviceType = hello.deviceType;
          connection.userId = await validateToken(hello.token);
          
          if (!connection.userId) {
            sendError("AUTH_FAILED", "Invalid or expired token", undefined, true);
            ws.close();
            return;
          }
          
          connection.authenticated = true;
          connection.heartbeatTimer = setInterval(() => {
            send({ type: "pong", ts: new Date().toISOString() });
          }, HEARTBEAT_INTERVAL_MS);

          send({
            type: "hello_ok",
            gatewayTime: new Date().toISOString(),
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
            userId: connection.userId,
          });
          break;
        }

        case "subscribe": {
          if (!connection.authenticated) {
            sendError("NOT_AUTHENTICATED", "Must send hello first");
            return;
          }

          const sub = msg as ClientSubscribe;
          const actor = await sessionManager.getOrLoadSession(sub.sessionId);
          
          if (!actor) {
            sendError("SESSION_NOT_FOUND", `Session ${sub.sessionId} not found`, sub.sessionId);
            return;
          }

          if (actor.userId !== connection.userId) {
            sendError("ACCESS_DENIED", "Not authorized for this session", sub.sessionId);
            return;
          }

          const missedEvents = actor.attachSubscriber(connection.clientId, ws, sub.lastAckSeq);
          connection.subscribedSessions.add(sub.sessionId);

          send({
            type: "subscribed",
            sessionId: sub.sessionId,
            currentState: actor.getStatus(),
            latestSeq: actor.getLatestSeq(),
          });

          for (const event of missedEvents) {
            send(event);
          }
          break;
        }

        case "unsubscribe": {
          const unsub = msg as ClientUnsubscribe;
          const actor = sessionManager.getSession(unsub.sessionId);
          
          if (actor) {
            actor.detachSubscriber(connection.clientId);
          }
          connection.subscribedSessions.delete(unsub.sessionId);

          send({
            type: "unsubscribed",
            sessionId: unsub.sessionId,
          });
          break;
        }

        case "input": {
          if (!connection.authenticated) {
            sendError("NOT_AUTHENTICATED", "Must send hello first");
            return;
          }

          const input = msg as ClientInput;
          const actor = sessionManager.getSession(input.sessionId);
          
          if (!actor) {
            sendError("SESSION_NOT_FOUND", `Session ${input.sessionId} not found`, input.sessionId);
            return;
          }

          const seq = actor.handleInput(input.data, input.clientInputId);
          
          send({
            type: "input_ack",
            sessionId: input.sessionId,
            clientInputId: input.clientInputId,
            acceptedSeq: seq,
          });
          break;
        }

        case "ack": {
          const ack = msg as ClientAck;
          const actor = sessionManager.getSession(ack.sessionId);
          if (actor) {
            actor.updateAck(connection.clientId, ack.seq);
          }
          break;
        }

        case "ping": {
          send({ type: "pong", ts: new Date().toISOString() });
          break;
        }

        case "create_session": {
          if (!connection.authenticated || !connection.userId) {
            sendError("NOT_AUTHENTICATED", "Must send hello first");
            return;
          }

          const create = msg as ClientCreateSession;
          
          try {
            const actor = await sessionManager.createSession({
              userId: connection.userId,
              agentType: create.agentType,
              workingDirectory: create.workingDirectory,
              worktreeId: create.worktreeId,
              repositoryId: create.repositoryId,
            });

            actor.setStatus("provisioning");

            send({
              type: "session_created",
              sessionId: actor.sessionId,
              status: actor.getStatus(),
            });

            startAgentForSession(actor, connection.userId).catch((error) => {
              console.error(`[Gateway] Failed to start agent for session ${actor.sessionId}:`, error);
              actor.setStatus("error", String(error));
            });
          } catch (error) {
            sendError("CREATE_FAILED", String(error), undefined, true);
          }
          break;
        }

        case "stop_session": {
          if (!connection.authenticated) {
            sendError("NOT_AUTHENTICATED", "Must send hello first");
            return;
          }

          const stop = msg as ClientStopSession;
          const actor = sessionManager.getSession(stop.sessionId);
          
          if (!actor) {
            sendError("SESSION_NOT_FOUND", `Session ${stop.sessionId} not found`, stop.sessionId);
            return;
          }

          if (actor.userId !== connection.userId) {
            sendError("ACCESS_DENIED", "Not authorized for this session", stop.sessionId);
            return;
          }

          actor.setStatus("stopping");
          await sessionManager.removeSession(stop.sessionId);

          send({
            type: "session_stopped",
            sessionId: stop.sessionId,
          });
          break;
        }
      }
    } catch (error) {
      console.error(`[Gateway] Session message error:`, error);
      sendError("INTERNAL_ERROR", String(error), undefined, true);
    }
  });

  ws.on("close", () => {
    if (connection.heartbeatTimer) {
      clearInterval(connection.heartbeatTimer);
    }

    for (const sessionId of connection.subscribedSessions) {
      const actor = sessionManager.getSession(sessionId);
      if (actor) {
        actor.detachSubscriber(connection.clientId);
      }
    }

    sessionConnections.delete(connectionId);
    console.log(`[Gateway] Session connection ${connectionId} closed`);
  });

  ws.on("error", (error) => {
    console.error(`[Gateway] Session connection error:`, error);
  });
}

async function validateToken(token: string): Promise<string | null> {
  if (!token) return null;
  return token;
}

async function startAgentForSession(actor: ReturnType<typeof sessionManager.getSession>, userId: string): Promise<void> {
  if (!actor) return;

  // Skip PTY session creation for non-PTY agents (e.g., elevenlabs, opencode chat)
  const ptyAgents = ["claude", "codex", "gemini", "kiro", "cursor-agent"];
  if (!ptyAgents.includes(actor.agentType)) {
    console.log(`[Gateway] Agent ${actor.agentType} is not PTY-based, skipping container setup`);
    actor.setStatus("running");
    return;
  }

  actor.setStatus("starting");

  try {
    const container = await ensureContainer(userId);
    const agentWs = connectToAgentContainer(container, actor.agentType, actor.workingDirectory);

    agentWs.on("open", () => {
      console.log(`[Gateway] Agent connected for session ${actor.sessionId}`);
      actor.setStatus("running");
    });

    agentWs.on("message", (data) => {
      actor.handleAgentOutput(data.toString());
      const c = userContainers.get(userId);
      if (c) c.lastActivity = new Date();
    });

    agentWs.on("close", (code) => {
      actor.handleAgentExit(code, null);
    });

    agentWs.on("error", (error) => {
      console.error(`[Gateway] Agent error for session ${actor.sessionId}:`, error);
      actor.setStatus("error", String(error));
    });

  } catch (error) {
    actor.setStatus("error", String(error));
    throw error;
  }
}

const wss = new WebSocketServer({ server });

wss.on("connection", async (clientWs, req) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname === "/events") {
    const userId = url.searchParams.get("userId");
    
    if (!userId) {
      clientWs.send(JSON.stringify({ type: "error", message: "userId required" }));
      clientWs.close();
      return;
    }

    const subId = generateId();
    const subscription: EventSubscription = {
      id: subId,
      userId,
      ws: clientWs,
      worktreeIds: new Set(),
      eventTypes: new Set(),
    };
    eventSubscriptions.set(subId, subscription);
    
    console.log(`[Gateway] Event subscription ${subId} created for user ${userId}`);
    
    clientWs.send(JSON.stringify({ 
      type: "connected", 
      subscriptionId: subId,
      timestamp: new Date().toISOString(),
    }));

    clientWs.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as LegacyClientMessage;
        handleEventSubscription(clientWs, message, subId);
      } catch (error) {
        clientWs.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      }
    });

    clientWs.on("close", () => {
      console.log(`[Gateway] Event subscription ${subId} closed`);
      eventSubscriptions.delete(subId);
    });

    clientWs.on("error", (error) => {
      console.error(`[Gateway] Event subscription error:`, error);
      eventSubscriptions.delete(subId);
    });

    return;
  }

  if (pathname === "/sessions") {
    handleSessionsWebSocket(clientWs);
    return;
  }

  const userId = url.searchParams.get("userId");
  const agentType = url.searchParams.get("agent") ?? "shell";
  const cwd = url.searchParams.get("cwd") ?? "/home/node";

  if (!userId) {
    clientWs.send(JSON.stringify({ type: "error", message: "userId required" }));
    clientWs.close();
    return;
  }

  const sessionId = generateId();
  console.log(`[Gateway] New session ${sessionId} for user ${userId}, agent ${agentType}`);

  const session: ProxySession = {
    id: sessionId,
    userId,
    agentWs: null,
    clientWs,
    agentType,
  };
  proxySessions.set(sessionId, session);

  try {
    const container = await ensureContainer(userId);
    const agentWs = connectToAgentContainer(container, agentType, cwd);
    session.agentWs = agentWs;

    agentWs.on("open", () => {
      console.log(`[Gateway] Connected to agent container for session ${sessionId}`);
    });

    agentWs.on("message", (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data.toString());
      }
      const c = userContainers.get(userId);
      if (c) c.lastActivity = new Date();
    });

    agentWs.on("close", () => {
      console.log(`[Gateway] Agent connection closed for session ${sessionId}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
      proxySessions.delete(sessionId);
    });

    agentWs.on("error", (error) => {
      console.error(`[Gateway] Agent WS error:`, error);
      clientWs.send(JSON.stringify({ type: "error", message: String(error) }));
    });

    clientWs.on("message", (data) => {
      if (agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(data.toString());
      }
      const c = userContainers.get(userId);
      if (c) c.lastActivity = new Date();
    });

    clientWs.on("close", () => {
      console.log(`[Gateway] Client disconnected: ${sessionId}`);
      if (agentWs.readyState === WebSocket.OPEN) {
        agentWs.close();
      }
      proxySessions.delete(sessionId);
    });

  } catch (error) {
    console.error(`[Gateway] Failed to setup session:`, error);
    clientWs.send(JSON.stringify({ type: "error", message: String(error) }));
    clientWs.close();
    proxySessions.delete(sessionId);
  }
});

server.listen(PORT, () => {
  persistenceWriter.start();
  sessionManager.start();
  sessionCleanup.start();
  
  console.log(`[Gateway] Running on port ${PORT} (ID: ${GATEWAY_ID})`);
  console.log(`[Gateway] Sessions WS: ws://localhost:${PORT}/sessions`);
  console.log(`[Gateway] Events WS: ws://localhost:${PORT}/events?userId=<id>`);
  console.log(`[Gateway] Legacy Agent WS: ws://localhost:${PORT}?userId=<id>&agent=<type>&cwd=<path>`);
  console.log(`[Gateway] Health: http://localhost:${PORT}/health`);
});

process.on("SIGTERM", async () => {
  console.log("[Gateway] Shutting down...");
  
  sessionCleanup.stop();
  sessionManager.stop();
  await persistenceWriter.stop();

  for (const conn of sessionConnections.values()) {
    if (conn.heartbeatTimer) clearInterval(conn.heartbeatTimer);
    conn.ws.close();
  }
  
  for (const session of proxySessions.values()) {
    session.agentWs?.close();
    session.clientWs.close();
  }

  for (const sub of eventSubscriptions.values()) {
    sub.ws.close();
  }

  server.close(() => {
    console.log("[Gateway] Server closed");
    process.exit(0);
  });
});
