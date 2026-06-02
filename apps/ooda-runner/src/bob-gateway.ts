import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import WebSocket from "ws";

import type { AgentAdapter, AdapterEvent } from "@gmacko/ooda/agent-adapters";
import { bobRunReporterFromEnv, type BobRunReporter } from "./bob-run-reporter";

const RECONNECT_DELAY_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

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
  | ServerSessionAvailable
  | { type: string };

export class BobGatewayConnector {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private activeSessions = new Map<string, ChildProcess>();
  private adapters: Map<string, AgentAdapter>;
  private stopped = false;
  // Reports gateway-dispatched runs to Bob's public API as agentRuns so they
  // appear in Recent Outcomes (the same surface the task-runner reports to).
  private bobReporter: BobRunReporter = bobRunReporterFromEnv();

  constructor(
    private config: BobGatewayConfig,
    adapters: Map<string, AgentAdapter>,
  ) {
    this.adapters = adapters;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
    for (const [sessionId, child] of this.activeSessions) {
      console.log(`[bob-gw] Interrupting session ${sessionId} (graceful shutdown)`);
      this.send({ type: "session_status", sessionId, status: "failed", summary: { reason: "interrupted", retryable: true } });
      child.kill("SIGTERM");
    }
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
      console.log("[bob-gw] Connected, sending hello");
      this.send({
        type: "hello",
        clientId: `executor-${process.pid}`,
        deviceType: "daemon",
        token: this.config.apiKey,
        workspaceId: this.config.workspaceId,
      });
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
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "hello_ok":
        console.log(`[bob-gw] Authenticated as user ${(msg as any).userId}`);
        break;
      case "error":
        console.error(`[bob-gw] Server error: ${(msg as any).code} - ${(msg as any).message}`);
        break;
      case "session_available":
        void this.handleSessionAvailable(msg as ServerSessionAvailable);
        break;
      case "pong":
        break;
    }
  }

  private async handleSessionAvailable(session: ServerSessionAvailable): Promise<void> {
    if (this.activeSessions.size >= this.config.maxConcurrent) {
      console.log(`[bob-gw] At capacity (${this.config.maxConcurrent}), skipping ${session.sessionId}`);
      return;
    }

    console.log(`[bob-gw] Claiming session ${session.sessionId}: ${session.title}`);
    this.send({ type: "session_claimed", sessionId: session.sessionId });
    this.send({ type: "session_status", sessionId: session.sessionId, status: "starting" });

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
        this.send({ type: "session_status", sessionId: session.sessionId, status: "error" });
        this.sendEvent(session.sessionId, "error", "system", { code: "WORKTREE_ERROR", message: msg });
        this.activeSessions.delete(session.sessionId);
        return;
      }
    } else {
      workDir = this.resolveWorkDir(session);
      if (!existsSync(workDir)) {
        console.error(`[bob-gw] Working directory not found: ${workDir}`);
        this.send({ type: "session_status", sessionId: session.sessionId, status: "error" });
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

    this.send({ type: "session_status", sessionId: session.sessionId, status: "running" });
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

      this.send({
        type: "session_status",
        sessionId: session.sessionId,
        status: "completed",
        summary: prUrl ? { pullRequestUrl: prUrl } : undefined,
      });
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
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[bob-gw] Session ${session.sessionId} failed: ${errMsg}`);
      this.send({ type: "session_status", sessionId: session.sessionId, status: "error" });
      this.sendEvent(session.sessionId, "error", "system", { code: "AGENT_ERROR", message: errMsg });
      await this.bobReporter.pushLog(bobRunId, runOutput).catch(() => {});
      await this.bobReporter.finishRun(bobRunId, "failed", { error: errMsg }).catch(() => {});
      void this.reportToBizPulse(session, "failed", Date.now() - startTime);
    } finally {
      if (worktree) await this.removeWorktree(worktree).catch(() => {});
      this.activeSessions.delete(session.sessionId);
    }
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
    const command = adapter.buildCommand({ prompt, workspaceRoot: workDir, systemPrompt });

    await adapter.execute(command, (event: AdapterEvent) => {
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
    });
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
        return { command: "codex", args: ["exec", "--full-auto", codexPrompt] };
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
    this.send({ type: "session_event", sessionId, eventType, direction, payload });
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
