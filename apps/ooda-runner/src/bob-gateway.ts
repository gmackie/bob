import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import WebSocket from "ws";

import type {
  AgentAdapter,
  AdapterEvent,
  AdapterProcessHandle,
} from "@gmacko/ooda/agent-adapters";
import { bobRunReporterFromEnv, type BobRunReporter } from "./bob-run-reporter";
import { EventBuffer } from "./event-buffer";

const RECONNECT_DELAY_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const HELLO_TIMEOUT_MS = 15_000;

/**
 * Extract a short, human-readable tail from an agent's captured output for use
 * in an error message. Prefers the last non-empty lines; if the output is
 * stream-json (claude/codex), pulls the message text out of the last few JSON
 * objects rather than dumping raw JSON. Capped so a bad run can't bloat the
 * surfaced error.
 */
export function outputTail(output: string, maxChars = 500): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const readable: string[] = [];
  for (const line of lines.slice(-12)) {
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const obj = JSON.parse(line) as {
          message?: unknown;
          error?: unknown;
          result?: unknown;
        };
        const text = obj.error ?? obj.message ?? obj.result;
        if (typeof text === "string" && text.trim()) readable.push(text.trim());
        continue;
      } catch {
        // fall through to raw line
      }
    }
    readable.push(line);
  }
  const tail = readable.slice(-6).join(" | ").trim();
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}

export interface BobGatewayConfig {
  gatewayUrl: string;
  apiKey: string;
  workspaceId: string;
  devDir: string;
  maxConcurrent: number;
}

interface WorktreeContext {
  path: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
}

interface ServerSessionAvailable {
  type: "session_available";
  sessionId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  sessionType?: "execution" | "planning";
  description?: string;
  identifier?: string;
  /**
   * Feature branch set by the server only when the work item's project has a
   * mapped repo. Its presence is the signal to run in an isolated worktree
   * (off `workingDirectory`, which then carries the repo path) and open a PR.
   */
  branch?: string;
  personaId?: string;
  personaConfig?: {
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    metadata?: Record<string, unknown>;
  };
  planningContext?: {
    workspaceId?: string;
    projectId?: string;
    projectName?: string;
    launchContext?: {
      intent: "shape" | "breakdown";
      notes: string;
      workItem?: { id: string; identifier: string; title: string; kind: string };
      selectedRepoSources: Array<{ id: string; label: string; path: string; detail: string }>;
      attachedFiles: Array<{ name: string; sizeLabel: string; content?: string }>;
    };
  };
}

type ServerMessage =
  | { type: "hello_ok"; userId: string; heartbeatIntervalMs: number }
  | { type: "error"; code: string; message: string }
  | { type: "pong" }
  | { type: "session_stop"; sessionId: string }
  | { type: "event_ack"; sessionId: string; sendSeq: number }
  | {
      type: "event";
      sessionId: string;
      eventType: string;
      direction: string;
      payload: Record<string, unknown>;
    }
  | ServerSessionAvailable
  | { type: string };

export class BobGatewayConnector {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;
  private authenticated = false;
  private reconnectAttempt = 0;
  private activeSessions = new Map<string, ChildProcess>();
  // Live control handles (kill/steer) for every in-flight run, adapter or CLI.
  private sessionHandles = new Map<string, AdapterProcessHandle>();
  // Sessions the user asked to stop — their exit is reported as interrupted, not error.
  private stopRequested = new Set<string>();
  private adapters: Map<string, AgentAdapter>;
  private stopped = false;
  // Reports gateway-dispatched runs to Bob's public API as agentRuns so they
  // appear in Recent Outcomes (the same surface the task-runner reports to).
  private bobReporter: BobRunReporter = bobRunReporterFromEnv();
  // Durable half of the envelope protocol: every mutation frame is journaled
  // with a per-session send-seq before it is sent, replayed on reconnect, and
  // truncated when the gateway acks it (event_ack).
  private buffer: EventBuffer;

  constructor(
    private config: BobGatewayConfig,
    adapters: Map<string, AgentAdapter>,
  ) {
    this.adapters = adapters;
    this.buffer = new EventBuffer(
      process.env.BOB_RUNNER_BUFFER_DIR ??
        join(homedir(), ".bob-runner", "event-buffer"),
    );
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
    for (const [sessionId, handle] of this.sessionHandles) {
      console.log(`[bob-gw] Interrupting session ${sessionId} (graceful shutdown)`);
      this.sendStatus(sessionId, "failed", { reason: "interrupted", retryable: true });
      handle.kill();
    }
    this.sessionHandles.clear();
    this.activeSessions.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.stopped) return;
    console.log(`[bob-gw] Connecting to ${this.config.gatewayUrl}`);
    this.ws = new WebSocket(this.config.gatewayUrl);

    this.ws.on("open", () => {
      this.reconnectAttempt = 0;
      this.authenticated = false;
      console.log("[bob-gw] Connected, sending hello");
      this.send({
        type: "hello",
        clientId: `executor-${process.pid}`,
        deviceType: "daemon",
        token: this.config.apiKey,
        workspaceId: this.config.workspaceId,
      });
      // If hello_ok never arrives (e.g. the gateway hit a transient DB error
      // handling hello), the socket is open but we're unregistered and will
      // never receive sessions — force a reconnect instead of idling forever.
      this.helloTimer = setTimeout(() => {
        if (!this.authenticated) {
          console.error("[bob-gw] No hello_ok within 15s, reconnecting");
          this.ws?.terminate();
        }
      }, HELLO_TIMEOUT_MS);
      this.startHeartbeat();
    });

    this.ws.on("message", (data) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    this.ws.on("close", () => {
      this.cleanup();
      if (this.stopped) return;
      this.reconnectAttempt++;
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt - 1), 60_000);
      console.log(`[bob-gw] Disconnected, reconnecting in ${delay / 1000}s`);
      setTimeout(() => this.connect(), delay);
    });

    this.ws.on("error", (err) => {
      console.error("[bob-gw] WebSocket error:", err.message);
    });
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Journal-then-send for every session mutation (claim, status, event).
   * The frame gets the session's next send-seq, hits disk first, and is
   * retransmitted from the journal on reconnect until the gateway acks it.
   * Never throws — a journaling failure degrades to fire-and-forget rather
   * than blocking the run.
   */
  private sendDurable(sessionId: string, frame: Record<string, unknown>): void {
    let sendSeq: number | undefined;
    try {
      sendSeq = this.buffer.assignSeq(sessionId);
      frame.sendSeq = sendSeq;
      this.buffer.append(sessionId, sendSeq, frame);
    } catch (err) {
      console.error(
        `[bob-gw] Event buffer write failed for ${sessionId} (degrading to fire-and-forget):`,
        err instanceof Error ? err.message : err,
      );
    }
    this.send(frame);
  }

  private sendStatus(
    sessionId: string,
    status: string,
    summary?: Record<string, unknown>,
  ): void {
    this.sendDurable(sessionId, {
      type: "session_status",
      sessionId,
      status,
      ...(summary ? { summary } : {}),
    });
  }

  /** Replay every unacked journaled frame (in send order) after (re)connect. */
  private replayUnacked(): void {
    for (const sessionId of this.buffer.sessionsWithUnacked()) {
      const frames = this.buffer.unacked(sessionId);
      if (frames.length === 0) continue;
      console.log(
        `[bob-gw] Replaying ${frames.length} unacked frame(s) for session ${sessionId}`,
      );
      for (const entry of frames) {
        this.send(entry.frame);
      }
    }
  }

  private handleEventAck(sessionId: string, sendSeq: number): void {
    this.buffer.ack(sessionId, sendSeq);
    // A finished session whose journal is fully acked has nothing left to
    // replay — free its files.
    if (!this.activeSessions.has(sessionId) && this.buffer.fullyAcked(sessionId)) {
      this.buffer.releaseSession(sessionId);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "ping", ts: new Date().toISOString() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.helloTimer) {
      clearTimeout(this.helloTimer);
      this.helloTimer = null;
    }
    this.authenticated = false;
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "hello_ok":
        this.authenticated = true;
        if (this.helloTimer) {
          clearTimeout(this.helloTimer);
          this.helloTimer = null;
        }
        console.log(`[bob-gw] Authenticated as user ${(msg as any).userId}`);
        // Replay everything the gateway never acked — this runs BEFORE any
        // reconciliation, so a completion journaled during the outage lands
        // before anything could orphan-mark the run.
        this.replayUnacked();
        break;
      case "event_ack": {
        const ack = msg as { type: "event_ack"; sessionId: string; sendSeq: number };
        if (typeof ack.sessionId === "string" && typeof ack.sendSeq === "number") {
          this.handleEventAck(ack.sessionId, ack.sendSeq);
        }
        break;
      }
      case "error":
        console.error(`[bob-gw] Server error: ${(msg as any).code} - ${(msg as any).message}`);
        // An error before hello_ok means our registration failed — the socket
        // is useless. Reconnect (with backoff) rather than idling unregistered.
        if (!this.authenticated) {
          this.ws?.terminate();
        }
        break;
      case "session_available":
        void this.handleSessionAvailable(msg as ServerSessionAvailable);
        break;
      case "session_stop":
        this.handleSessionStop((msg as { sessionId: string }).sessionId);
        break;
      case "event":
        this.handleInboundEvent(
          msg as { sessionId: string; eventType: string; payload: Record<string, unknown> },
        );
        break;
      case "pong":
        break;
    }
  }

  /** User asked to stop a run: kill the agent process; the run's exit path
   *  sees `stopRequested` and reports `interrupted` instead of error. */
  private handleSessionStop(sessionId: string): void {
    const handle = this.sessionHandles.get(sessionId);
    if (!handle) {
      console.log(`[bob-gw] Stop requested for unknown session ${sessionId} (already finished?)`);
      return;
    }
    console.log(`[bob-gw] Stopping session ${sessionId} (user request)`);
    this.stopRequested.add(sessionId);
    this.sendEvent(sessionId, "state", "system", { status: "stopping", reason: "user_request" });
    handle.kill();
  }

  /** Browser → daemon frames relayed by the gateway. Only `input` (steering
   *  a running agent) is meaningful today. */
  private handleInboundEvent(msg: {
    sessionId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): void {
    if (msg.eventType !== "input") return;
    const text = typeof msg.payload?.data === "string" ? msg.payload.data : "";
    if (!text.trim()) return;

    const handle = this.sessionHandles.get(msg.sessionId);
    const accepted = handle?.write(text) ?? false;
    if (accepted) {
      console.log(`[bob-gw] Steering input accepted for session ${msg.sessionId}`);
      // Persist the user's message into the session transcript (the gateway's
      // relay of the original input frame is delivery-only, never persisted).
      this.sendEvent(msg.sessionId, "input", "client", {
        data: text,
        clientInputId: msg.payload?.clientInputId,
      });
    } else {
      console.log(`[bob-gw] Steering input rejected for session ${msg.sessionId} (no live agent or unsupported)`);
      this.sendEvent(msg.sessionId, "error", "system", {
        code: "STEER_UNAVAILABLE",
        message: handle
          ? "This agent type doesn't support follow-up input mid-run."
          : "No running agent for this session — it may have already finished.",
      });
    }
  }

  private async handleSessionAvailable(session: ServerSessionAvailable): Promise<void> {
    if (this.activeSessions.size >= this.config.maxConcurrent) {
      console.log(`[bob-gw] At capacity (${this.config.maxConcurrent}), skipping ${session.sessionId}`);
      return;
    }

    console.log(`[bob-gw] Claiming session ${session.sessionId}: ${session.title}`);
    this.sendDurable(session.sessionId, {
      type: "session_claimed",
      sessionId: session.sessionId,
    });
    this.sendStatus(session.sessionId, "starting");

    // When the server mapped a repo + branch, run in an isolated git worktree
    // off that repo so the agent never touches the runner's own checkout and so
    // we can push the branch + open a PR. Otherwise fall back to the legacy dir.
    let workDir: string;
    let worktree: WorktreeContext | null = null;
    if (
      session.branch &&
      existsSync(session.workingDirectory) &&
      existsSync(join(session.workingDirectory, ".git"))
    ) {
      try {
        const repoPath = session.workingDirectory;
        const baseBranch = await this.detectBaseBranch(repoPath);
        worktree = await this.setupWorktree(repoPath, session.branch, baseBranch);
        workDir = worktree.path;
        console.log(`[bob-gw] worktree ready: ${workDir} (branch ${worktree.branch})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bob-gw] worktree setup failed: ${msg}`);
        this.sendStatus(session.sessionId, "error", { code: "WORKTREE_ERROR", error: msg });
        this.sendEvent(session.sessionId, "error", "system", { code: "WORKTREE_ERROR", message: msg });
        this.activeSessions.delete(session.sessionId);
        return;
      }
    } else {
      workDir = this.resolveWorkDir(session);
      if (!existsSync(workDir)) {
        console.error(`[bob-gw] Working directory not found: ${workDir}`);
        this.sendStatus(session.sessionId, "error");
        this.activeSessions.delete(session.sessionId);
        return;
      }
      if (session.branch) {
        await this.gitCheckoutBranch(workDir, session.branch).catch(() => {});
      }
    }

    const prompt = this.buildPrompt(session);
    const adapterId = session.agentType || "claude";
    const adapter = adapterId !== "codex" ? this.adapters.get(adapterId) : undefined;

    this.sendStatus(session.sessionId, "running");
    this.sendEvent(session.sessionId, "state", "system", { status: "running" });

    // Record an agentRun so this shows in Recent Outcomes (via <agent>), the
    // same surface the task-runner reports to. workItemId uses the identifier
    // (publicApiCreateRun matches it to the work item by externalId).
    const bobRunId = await this.bobReporter
      .startRun({
        workItemId: session.identifier ?? session.sessionId,
        agentType: adapterId,
        title: session.title,
      })
      .catch(() => null);
    let runOutput = "";
    const collect = (s: string) => {
      runOutput += s;
      if (runOutput.length > 200_000) runOutput = runOutput.slice(-200_000);
    };

    const startTime = Date.now();
    try {
      if (adapter) {
        await this.runWithAdapter(session, adapter, workDir, prompt, collect);
      } else {
        await this.runWithCli(session, workDir, prompt, collect);
      }

      if (this.stopRequested.has(session.sessionId)) {
        await this.reportInterrupted(session, bobRunId, runOutput, startTime);
        return;
      }

      // Worktree path: push the branch and open a PR if commits were produced.
      let prUrl: string | null = null;
      if (worktree) {
        prUrl = await this.finalizeWorktreePr(session, worktree).catch((e) => {
          console.warn(`[bob-gw] PR finalize failed: ${e instanceof Error ? e.message : e}`);
          return null;
        });
        if (prUrl) {
          this.sendEvent(session.sessionId, "pull_request", "agent", {
            url: prUrl,
            branch: worktree.branch,
          });
        }
      }

      // Include branch + base so the gateway can record the PR in bob's
      // pull_requests table (this path opens the PR on the git host but the
      // gateway owns the DB tracking).
      this.sendStatus(
        session.sessionId,
        "completed",
        prUrl
          ? {
              pullRequestUrl: prUrl,
              branch: worktree?.branch,
              baseBranch: worktree?.baseBranch,
            }
          : undefined,
      );
      this.sendEvent(session.sessionId, "state", "system", {
        status: "completed",
        pullRequestUrl: prUrl ?? undefined,
      });
      console.log(`[bob-gw] Session ${session.sessionId} completed${prUrl ? ` → ${prUrl}` : ""}`);
      await this.bobReporter.pushLog(bobRunId, runOutput).catch(() => {});
      await this.bobReporter
        .finishRun(bobRunId, "completed", { pullRequestUrl: prUrl ?? undefined })
        .catch(() => {});
      void this.reportToBizPulse(session, "completed", Date.now() - startTime);
    } catch (err) {
      // A user-requested stop kills the process, which surfaces here as a
      // non-zero exit — that's an interruption, not an agent failure.
      if (this.stopRequested.has(session.sessionId)) {
        await this.reportInterrupted(session, bobRunId, runOutput, startTime);
        return;
      }
      const baseMsg = err instanceof Error ? err.message : String(err);
      // "Agent exited with code N" alone is useless for diagnosis. When the
      // failure is a bare exit, append the tail of the agent's own output
      // (usually its last error lines) so the surfaced error is actionable.
      const tail = /exited with code/.test(baseMsg)
        ? outputTail(runOutput)
        : "";
      const errMsg = tail ? `${baseMsg} — ${tail}` : baseMsg;
      console.error(`[bob-gw] Session ${session.sessionId} failed: ${errMsg}`);
      this.sendStatus(session.sessionId, "error", { code: "AGENT_ERROR", error: errMsg });
      this.sendEvent(session.sessionId, "error", "system", { code: "AGENT_ERROR", message: errMsg });
      await this.bobReporter.pushLog(bobRunId, runOutput).catch(() => {});
      await this.bobReporter.finishRun(bobRunId, "failed", { error: errMsg }).catch(() => {});
      void this.reportToBizPulse(session, "failed", Date.now() - startTime);
    } finally {
      if (worktree) await this.removeWorktree(worktree).catch(() => {});
      this.activeSessions.delete(session.sessionId);
      this.sessionHandles.delete(session.sessionId);
      this.stopRequested.delete(session.sessionId);
    }
  }

  private async reportInterrupted(
    session: ServerSessionAvailable,
    bobRunId: string | null,
    runOutput: string,
    startTime: number,
  ): Promise<void> {
    console.log(`[bob-gw] Session ${session.sessionId} interrupted by user`);
    this.sendStatus(session.sessionId, "interrupted", { reason: "stopped_by_user" });
    this.sendEvent(session.sessionId, "state", "system", {
      status: "interrupted",
      reason: "stopped_by_user",
    });
    await this.bobReporter.pushLog(bobRunId, runOutput).catch(() => {});
    await this.bobReporter
      .finishRun(bobRunId, "failed", { reason: "stopped_by_user" })
      .catch(() => {});
    void this.reportToBizPulse(session, "failed", Date.now() - startTime);
  }

  /** Detect the repo's default branch (origin/HEAD), falling back to main/master. */
  private async detectBaseBranch(repoPath: string): Promise<string> {
    const head = await this
      .git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
      .then((s) => s.trim().replace(/^origin\//, ""))
      .catch(() => "");
    if (head) return head;
    for (const candidate of ["main", "master"]) {
      const ok = await this
        .git(repoPath, ["rev-parse", "--verify", `origin/${candidate}`])
        .then(() => true)
        .catch(() => false);
      if (ok) return candidate;
    }
    return "main";
  }

  /** Create an isolated git worktree on a fresh feature branch off the base. */
  private async setupWorktree(
    repoPath: string,
    branch: string,
    baseBranch: string,
  ): Promise<WorktreeContext> {
    const repoName = basename(repoPath);
    const safeBranch = branch.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const wtPath = join(homedir(), ".bob", "worktrees", repoName, safeBranch);

    await this.git(repoPath, ["fetch", "origin", baseBranch]).catch(() => {});

    if (existsSync(wtPath)) {
      await this.git(repoPath, ["worktree", "remove", "--force", wtPath]).catch(() => {});
      rmSync(wtPath, { recursive: true, force: true });
    }
    mkdirSync(dirname(wtPath), { recursive: true });

    // Prefer forking from origin/<base>; fall back to the local base branch.
    try {
      await this.git(repoPath, ["worktree", "add", "-B", branch, wtPath, `origin/${baseBranch}`]);
    } catch {
      await this.git(repoPath, ["worktree", "add", "-B", branch, wtPath, baseBranch]);
    }
    return { path: wtPath, repoPath, branch, baseBranch };
  }

  /** Push the worktree branch and open a PR if the agent produced commits. */
  private async finalizeWorktreePr(
    session: ServerSessionAvailable,
    worktree: WorktreeContext,
  ): Promise<string | null> {
    const ahead = (
      await this.git(worktree.path, [
        "rev-list",
        "--count",
        `origin/${worktree.baseBranch}..HEAD`,
      ]).catch(() => "0")
    ).trim();
    if (!ahead || ahead === "0") {
      console.log(`[bob-gw] No commits on ${worktree.branch}; skipping PR`);
      return null;
    }

    await this.git(worktree.path, ["push", "-u", "origin", worktree.branch, "--force"]);

    const remote = (
      await this.git(worktree.repoPath, ["remote", "get-url", "origin"])
    ).trim();
    return this.createPullRequest(
      worktree.path,
      remote,
      worktree.branch,
      worktree.baseBranch,
      session.title ?? worktree.branch,
      session.description ?? "Automated by Bob agent.",
    );
  }

  /**
   * Open a PR for the pushed branch, host-aware:
   * - github.com → `gh pr create` (the runner host is authenticated)
   * - Forgejo/Gitea over HTTPS with a token in the remote URL → REST API
   * - otherwise (e.g. SSH gitea without a token) → push-only, PR opened manually
   */
  private async createPullRequest(
    worktreePath: string,
    remoteUrl: string,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<string | null> {
    const parsed = this.parseRemote(remoteUrl);
    if (!parsed) {
      console.warn(`[bob-gw] could not parse remote for PR`);
      return null;
    }
    const { host, owner, repo, token } = parsed;
    const prTitle = `[Bob] ${title}`;

    if (host === "github.com") {
      try {
        const out = await this.run(
          "gh",
          ["pr", "create", "--repo", `${owner}/${repo}`, "--head", head, "--base", base, "--title", prTitle, "--body", body],
          worktreePath,
        );
        return (out.match(/https?:\/\/\S+/) || [])[0] ?? null;
      } catch (e) {
        console.warn(`[bob-gw] gh pr create failed: ${e instanceof Error ? e.message : e}`);
        return null;
      }
    }

    if (token) {
      const res = await fetch(`https://${host}/api/v1/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `token ${token}` },
        body: JSON.stringify({ head, base, title: prTitle, body }),
      });
      if (!res.ok) {
        console.warn(`[bob-gw] Gitea PR create ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        return null;
      }
      const pr = (await res.json()) as { html_url?: string; url?: string };
      return pr.html_url ?? pr.url ?? null;
    }

    console.warn(`[bob-gw] no PR method for ${host}; pushed ${head} (open PR manually)`);
    return null;
  }

  /** Parse a git remote (SSH or HTTPS) into host/owner/repo (+ token if embedded). */
  private parseRemote(
    remoteUrl: string,
  ): { host: string; owner: string; repo: string; token?: string } | null {
    let m = remoteUrl.match(/^[^@]+@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
    if (m) return { host: m[1]!, owner: m[2]!, repo: m[3]! };
    m = remoteUrl.match(/^https?:\/\/(?:([^:@/]+):([^@/]+)@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (m) return { host: m[3]!, owner: m[4]!, repo: m[5]!, token: m[2] };
    return null;
  }

  /** Run a command in cwd, resolving stdout (rejects on non-zero exit). */
  private run(cmd: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
      let out = "";
      let err = "";
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
      child.on("close", (code) =>
        code === 0 ? resolve(out) : reject(new Error(`${cmd}: ${err || out}`)),
      );
      child.on("error", reject);
    });
  }

  private async removeWorktree(worktree: WorktreeContext): Promise<void> {
    await this.git(worktree.repoPath, [
      "worktree",
      "remove",
      "--force",
      worktree.path,
    ]).catch(() => {});
  }

  /** Run a git command in cwd, resolving stdout or rejecting with stderr. */
  private git(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
      child.on("close", (code) =>
        code === 0 ? resolve(out) : reject(new Error(`git ${args.join(" ")}: ${err || out}`)),
      );
      child.on("error", reject);
    });
  }

  private async runWithAdapter(
    session: ServerSessionAvailable,
    adapter: AgentAdapter,
    workDir: string,
    prompt: string,
    onChunk?: (s: string) => void,
  ): Promise<void> {
    const systemPrompt = this.buildSystemPrompt(session);
    const persona = session.personaConfig;
    const command = adapter.buildCommand({
      prompt,
      workspaceRoot: workDir,
      systemPrompt,
      model: persona?.model,
      allowedTools: persona?.allowedTools,
    });

    const { exitCode } = await adapter.execute(command, (event: AdapterEvent) => {
      if (event.type === "stdout" || event.type === "stderr") {
        onChunk?.(event.data);
        this.sendEvent(session.sessionId, "output_chunk", "agent", {
          data: event.data,
          stream: event.type,
        });
      } else if (event.type === "thought") {
        this.sendEvent(session.sessionId, "thought", "agent", {
          text: event.thought?.text ?? event.data,
        });
      } else if (event.type === "tool_call" || event.type === "tool_result") {
        this.sendEvent(session.sessionId, "tool_call", "agent", {
          phase: event.type === "tool_call" ? "start" : "end",
          ...event.tool,
        });
      }
    }, {
      onSpawn: (handle) => this.sessionHandles.set(session.sessionId, handle),
    });

    if (exitCode !== 0 && !this.stopRequested.has(session.sessionId)) {
      throw new Error(`Agent exited with code ${exitCode}`);
    }
  }

  private runWithCli(
    session: ServerSessionAvailable,
    workDir: string,
    prompt: string,
    onChunk?: (s: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const { command, args } = this.getCliCommand(session.agentType || "claude", prompt, session);
      console.log(`[bob-gw] Spawning: ${command} ${args.join(" ").slice(0, 80)}...`);

      const child = spawn(command, args, {
        cwd: workDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CI: "true", TERM: "dumb" },
      });

      this.activeSessions.set(session.sessionId, child);
      // CLI-spawned agents (codex/cursor) run with stdin ignored: they can be
      // stopped but not steered.
      this.sessionHandles.set(session.sessionId, {
        write: () => false,
        kill: () => {
          child.kill("SIGTERM");
          const escalate = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill("SIGKILL");
            }
          }, 5000);
          escalate.unref?.();
        },
      });

      child.stdout?.on("data", (data: Buffer) => {
        onChunk?.(data.toString());
        this.sendEvent(session.sessionId, "output_chunk", "agent", {
          data: data.toString(),
          stream: "stdout",
        });
      });

      child.stderr?.on("data", (data: Buffer) => {
        onChunk?.(data.toString());
        this.sendEvent(session.sessionId, "output_chunk", "agent", {
          data: data.toString(),
          stream: "stderr",
        });
      });

      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Agent exited with code ${code}`));
      });

      child.on("error", (err) => reject(new Error(`Failed to spawn agent: ${err.message}`)));

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5000);
      }, 30 * 60 * 1000);

      child.on("close", () => clearTimeout(timeout));
    });
  }

  private getCliCommand(
    agentType: string,
    prompt: string,
    session: ServerSessionAvailable,
  ): { command: string; args: string[] } {
    const persona = session.personaConfig;
    switch (agentType) {
      case "claude": {
        const args = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
        if (persona?.model) args.push("--model", persona.model);
        if (persona?.allowedTools?.length) args.push("--allowedTools", persona.allowedTools.join(","));
        if (persona?.systemPrompt) args.push("--append-system-prompt", persona.systemPrompt);
        args.push(prompt);
        return { command: "claude", args };
      }
      case "codex": {
        const codexPrompt = persona?.systemPrompt
          ? `${persona.systemPrompt}\n\n---\n\n${prompt}`
          : prompt;
        // codex-cli 0.135 grammar: `--full-auto` is deprecated, and exec
        // refuses to run outside a trusted git dir without --skip-git-repo-check
        // (Bob's fallback workdir isn't always a repo). --dangerously-bypass-
        // approvals-and-sandbox = non-interactive autonomy (the box IS the
        // sandbox), matching claude's --dangerously-skip-permissions posture.
        // --json emits JSONL events we stream as output.
        const codexArgs = [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "--dangerously-bypass-approvals-and-sandbox",
        ];
        if (persona?.model) codexArgs.push("-m", persona.model);
        codexArgs.push(codexPrompt);
        return { command: "codex", args: codexArgs };
      }
      case "cursor": {
        const cursorArgs = ["--print", "--yolo", "--trust"];
        if (persona?.model) cursorArgs.push("--model", persona.model);
        const cursorPrompt = persona?.systemPrompt
          ? `${persona.systemPrompt}\n\n---\n\n${prompt}`
          : prompt;
        cursorArgs.push(cursorPrompt);
        return { command: "agent", args: cursorArgs };
      }
      default: {
        const args = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
        if (persona?.model) args.push("--model", persona.model);
        if (persona?.systemPrompt) args.push("--append-system-prompt", persona.systemPrompt);
        args.push(prompt);
        return { command: "claude", args };
      }
    }
  }

  private buildSystemPrompt(session: ServerSessionAvailable): string | undefined {
    const persona = session.personaConfig;
    if (!persona?.systemPrompt && !persona?.autonomyLevel) return undefined;
    let sp = persona?.systemPrompt ?? "";
    if (persona?.autonomyLevel) {
      sp += `\n\nAutonomy level: ${persona.autonomyLevel}. Operate within this level.`;
    }
    return sp.trim() || undefined;
  }

  private buildPrompt(session: ServerSessionAvailable): string {
    const parts: string[] = [];
    if (session.identifier && session.title) {
      parts.push(`Task: ${session.identifier} - ${session.title}`);
    } else if (session.title) {
      parts.push(`Task: ${session.title}`);
    }
    if (session.description) parts.push(`\nDescription:\n${session.description}`);
    if (session.branch) parts.push(`\nWork on branch: ${session.branch}`);

    const bizpulse = session.personaConfig?.metadata?.bizpulse as
      | { startupSlug?: string }
      | undefined;
    if (bizpulse?.startupSlug) {
      parts.push(`\nYou are operating on startup: ${bizpulse.startupSlug}`);
    }

    if (session.planningContext?.launchContext) {
      const lc = session.planningContext.launchContext;
      parts.push(`\nPlanning intent: ${lc.intent}`);
      if (lc.notes) parts.push(`\nBrief: ${lc.notes}`);
      if (lc.workItem) {
        parts.push(`\nWork item: ${lc.workItem.identifier} - ${lc.workItem.title} (${lc.workItem.kind})`);
      }
    }

    if (session.sessionType === "planning") {
      parts.push("\n\nAnalyze the codebase and create a structured plan with draft tasks.");
    } else {
      parts.push("\n\nImplement this task. Create a commit when done.");
    }
    return parts.join("\n");
  }

  private resolveWorkDir(session: ServerSessionAvailable): string {
    if (session.workingDirectory && existsSync(session.workingDirectory)) {
      return session.workingDirectory;
    }
    return this.config.devDir;
  }

  private sendEvent(sessionId: string, eventType: string, direction: string, payload: Record<string, unknown>): void {
    this.sendDurable(sessionId, { type: "session_event", sessionId, eventType, direction, payload });
  }

  private async reportToBizPulse(
    session: ServerSessionAvailable,
    status: "completed" | "failed",
    durationMs: number,
  ): Promise<void> {
    const bizpulse = session.personaConfig?.metadata?.bizpulse as
      | { apiUrl?: string; agentSlug?: string; startupSlug?: string }
      | undefined;
    if (!bizpulse?.apiUrl || !bizpulse?.agentSlug) return;

    try {
      await fetch(`${bizpulse.apiUrl}/api/agent/report-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.PULSE_API_KEY ?? ""}`,
        },
        body: JSON.stringify({
          agentSlug: bizpulse.agentSlug,
          externalSessionId: session.sessionId,
          startupSlug: bizpulse.startupSlug ?? null,
          title: session.title ?? null,
          status,
          durationMs,
        }),
      });
      console.log(`[bob-gw] BizPulse report sent for session ${session.sessionId}`);
    } catch (err) {
      console.warn(`[bob-gw] BizPulse report failed:`, err instanceof Error ? err.message : err);
    }
  }

  private gitCheckoutBranch(workDir: string, branch: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["checkout", "-B", branch], { cwd: workDir, stdio: "pipe" });
      let stderr = "";
      child.stderr?.on("data", (d) => { stderr += d.toString(); });
      child.on("close", (code) => { if (code === 0) resolve(); else reject(new Error(stderr)); });
      child.on("error", reject);
    });
  }
}
