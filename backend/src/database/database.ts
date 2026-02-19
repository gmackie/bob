import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import sqlite3 from "sqlite3";

import {
  AgentInstance,
  ClaudeInstance,
  Repository,
  WorkspaceEventOutbox,
  WorkspaceOperation,
  WorkspaceRun,
  WorkspaceRunStatus,
  Worktree,
} from "../types.js";
import { MigrationRunner } from "./migration-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseSqliteDate(value: string): Date {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

export class DatabaseService {
  private db: sqlite3.Database;
  private migrationRunner: MigrationRunner;
  public run: (sql: string, params?: any[]) => Promise<sqlite3.RunResult>;
  public get: (sql: string, params?: any[]) => Promise<any>;
  public all: (sql: string, params?: any[]) => Promise<any[]>;
  public exec: (sql: string) => Promise<void>;

  private initPromise: Promise<void>;

  constructor(dbPath: string = "bob.db") {
    this.db = new sqlite3.Database(dbPath);

    // Custom promisify for run method to properly handle the callback signature
    this.run = (sql: string, params?: any[]) => {
      return new Promise<sqlite3.RunResult>((resolve, reject) => {
        this.db.run(
          sql,
          params || [],
          function (this: sqlite3.RunResult, err: Error | null) {
            if (err) {
              reject(err);
            } else {
              resolve(this);
            }
          },
        );
      });
    };

    this.get = promisify(this.db.get.bind(this.db));
    this.all = promisify(this.db.all.bind(this.db));
    this.exec = promisify(this.db.exec.bind(this.db));
    this.migrationRunner = new MigrationRunner(this.db);
    this.initPromise = this.initialize();
  }

  async waitForInit(): Promise<void> {
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    try {
      console.log("Initializing database...");
      await this.migrationRunner.init();
      console.log("Running database migrations...");
      await this.migrationRunner.runPendingMigrations();
      console.log("Database ready");
    } catch (error) {
      console.error("Failed to initialize database:", error);
      throw error;
    }
  }

  getMigrationRunner(): MigrationRunner {
    return this.migrationRunner;
  }

  // Repository methods
  async saveRepository(repo: Repository): Promise<void> {
    const userId = repo.userId || "default-user";
    await this.run(
      `INSERT OR REPLACE INTO repositories (id, user_id, name, path, branch, main_branch) VALUES (?, ?, ?, ?, ?, ?)`,
      [repo.id, userId, repo.name, repo.path, repo.branch, repo.mainBranch],
    );
  }

  async getRepository(id: string, userId?: string): Promise<Repository | null> {
    const query = userId
      ? "SELECT * FROM repositories WHERE id = ? AND user_id = ?"
      : "SELECT * FROM repositories WHERE id = ?";
    const params = userId ? [id, userId] : [id];
    const row = await this.get(query, params);

    if (!row) return null;

    const worktrees = await this.getWorktreesByRepository(id, row.user_id);

    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      path: row.path,
      branch: row.branch,
      mainBranch: row.main_branch || row.branch,
      worktrees,
    };
  }

  async getAllRepositories(userId?: string): Promise<Repository[]> {
    const query = userId
      ? "SELECT * FROM repositories WHERE user_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM repositories ORDER BY created_at DESC";
    const params = userId ? [userId] : [];
    const rows = await this.all(query, params);

    const repositories = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        path: row.path,
        branch: row.branch,
        mainBranch: row.main_branch || row.branch,
        worktrees: await this.getWorktreesByRepository(row.id, row.user_id),
      })),
    );

    return repositories;
  }

  async deleteRepository(id: string, userId?: string): Promise<void> {
    const query = userId
      ? "DELETE FROM repositories WHERE id = ? AND user_id = ?"
      : "DELETE FROM repositories WHERE id = ?";
    const params = userId ? [id, userId] : [id];
    await this.run(query, params);
  }

  // Worktree methods
  async saveWorktree(worktree: Worktree): Promise<void> {
    const userId = worktree.userId || "default-user";
    await this.run(
      `INSERT OR REPLACE INTO worktrees (id, user_id, repository_id, path, branch, preferred_agent) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        worktree.id,
        userId,
        worktree.repositoryId,
        worktree.path,
        worktree.branch,
        worktree.preferredAgent || "claude",
      ],
    );
  }

  async getWorktree(id: string, userId?: string): Promise<Worktree | null> {
    const query = userId
      ? "SELECT * FROM worktrees WHERE id = ? AND user_id = ?"
      : "SELECT * FROM worktrees WHERE id = ?";
    const params = userId ? [id, userId] : [id];
    const row = await this.get(query, params);

    if (!row) return null;

    const instances = await this.getInstancesByWorktree(id, row.user_id);

    return {
      id: row.id,
      userId: row.user_id,
      repositoryId: row.repository_id,
      path: row.path,
      branch: row.branch,
      preferredAgent: row.preferred_agent || "claude",
      instances,
      isMainWorktree: false,
    };
  }

  async getWorktreesByRepository(
    repositoryId: string,
    userId?: string,
  ): Promise<Worktree[]> {
    const query = userId
      ? "SELECT * FROM worktrees WHERE repository_id = ? AND user_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM worktrees WHERE repository_id = ? ORDER BY created_at DESC";
    const params = userId ? [repositoryId, userId] : [repositoryId];
    const rows = await this.all(query, params);

    const worktrees = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        userId: row.user_id,
        repositoryId: row.repository_id,
        path: row.path,
        branch: row.branch,
        preferredAgent: row.preferred_agent || "claude",
        instances: await this.getInstancesByWorktree(row.id, row.user_id),
        isMainWorktree: false,
      })),
    );

    return worktrees;
  }

  async deleteWorktree(id: string, userId?: string): Promise<void> {
    const query = userId
      ? "DELETE FROM worktrees WHERE id = ? AND user_id = ?"
      : "DELETE FROM worktrees WHERE id = ?";
    const params = userId ? [id, userId] : [id];
    await this.run(query, params);
  }

  async saveWorkspaceRun(
    runData: Omit<WorkspaceRun, "createdAt" | "updatedAt">,
  ): Promise<void> {
    const userId = runData.userId || "default-user";
    await this.run(
      `INSERT INTO workspace_runs
       (run_id, user_id, task_id, workspace_id, repository_id, agent_id, base_rev, head_rev, workspace_path, status, test_status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, run_id) DO UPDATE SET
         user_id = excluded.user_id,
         task_id = excluded.task_id,
         workspace_id = excluded.workspace_id,
         repository_id = excluded.repository_id,
         agent_id = excluded.agent_id,
         base_rev = excluded.base_rev,
         head_rev = excluded.head_rev,
         workspace_path = excluded.workspace_path,
         status = excluded.status,
         test_status = excluded.test_status,
         error = excluded.error`,
      [
        runData.runId,
        userId,
        runData.taskId,
        runData.workspaceId,
        runData.repositoryId,
        runData.agentId,
        runData.baseRev,
        runData.headRev,
        runData.workspacePath,
        runData.status,
        runData.testStatus || null,
        runData.error || null,
      ],
    );
  }

  async getWorkspaceRun(
    runId: string,
    userId?: string,
  ): Promise<WorkspaceRun | null> {
    const effectiveUserId = userId || "default-user";
    const query =
      "SELECT * FROM workspace_runs WHERE run_id = ? AND user_id = ?";
    const params = [runId, effectiveUserId];
    const row = await this.get(query, params);
    if (!row) return null;

    return {
      runId: row.run_id,
      userId: row.user_id,
      taskId: row.task_id,
      workspaceId: row.workspace_id,
      repositoryId: row.repository_id,
      agentId: row.agent_id,
      baseRev: row.base_rev,
      headRev: row.head_rev,
      workspacePath: row.workspace_path,
      status: row.status,
      testStatus: row.test_status || undefined,
      error: row.error || undefined,
      createdAt: parseSqliteDate(row.created_at),
      updatedAt: parseSqliteDate(row.updated_at),
    };
  }

  async updateWorkspaceRun(
    runId: string,
    userId: string | undefined,
    updates: Partial<{
      headRev: string;
      status: WorkspaceRunStatus;
      testStatus: string | null;
      error: string | null;
    }>,
  ): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];

    if (updates.headRev !== undefined) {
      sets.push("head_rev = ?");
      params.push(updates.headRev);
    }
    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }
    if (updates.testStatus !== undefined) {
      sets.push("test_status = ?");
      params.push(updates.testStatus);
    }
    if (updates.error !== undefined) {
      sets.push("error = ?");
      params.push(updates.error);
    }

    if (sets.length === 0) return;

    const effectiveUserId = userId || "default-user";
    params.push(runId, effectiveUserId);
    await this.run(
      `UPDATE workspace_runs SET ${sets.join(", ")} WHERE run_id = ? AND user_id = ?`,
      params,
    );
  }

  async deleteWorkspaceRun(runId: string, userId?: string): Promise<void> {
    const effectiveUserId = userId || "default-user";
    await this.run(
      "DELETE FROM workspace_runs WHERE run_id = ? AND user_id = ?",
      [runId, effectiveUserId],
    );
  }

  async findWorkspaceOperation(
    userId: string,
    runId: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<WorkspaceOperation | null> {
    const row = await this.get(
      "SELECT * FROM workspace_operations WHERE user_id = ? AND run_id = ? AND operation = ? AND idempotency_key = ?",
      [userId, runId, operation, idempotencyKey],
    );
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      runId: row.run_id,
      operation: row.operation,
      idempotencyKey: row.idempotency_key,
      requestHash: row.request_hash,
      status: row.status,
      resultJson: row.result_json || undefined,
      error: row.error || undefined,
      createdAt: parseSqliteDate(row.created_at),
      updatedAt: parseSqliteDate(row.updated_at),
    };
  }

  async saveWorkspaceOperation(
    operation: Omit<WorkspaceOperation, "createdAt" | "updatedAt">,
  ): Promise<void> {
    await this.run(
      `INSERT INTO workspace_operations
       (id, user_id, run_id, operation, idempotency_key, request_hash, status, result_json, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         run_id = excluded.run_id,
         operation = excluded.operation,
         idempotency_key = excluded.idempotency_key,
         request_hash = excluded.request_hash,
         status = excluded.status,
         result_json = excluded.result_json,
         error = excluded.error`,
      [
        operation.id,
        operation.userId || "default-user",
        operation.runId,
        operation.operation,
        operation.idempotencyKey,
        operation.requestHash,
        operation.status,
        operation.resultJson || null,
        operation.error || null,
      ],
    );
  }

  async createWorkspaceOperation(
    operation: Omit<WorkspaceOperation, "createdAt" | "updatedAt">,
  ): Promise<void> {
    await this.run(
      `INSERT INTO workspace_operations
       (id, user_id, run_id, operation, idempotency_key, request_hash, status, result_json, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        operation.id,
        operation.userId || "default-user",
        operation.runId,
        operation.operation,
        operation.idempotencyKey,
        operation.requestHash,
        operation.status,
        operation.resultJson || null,
        operation.error || null,
      ],
    );
  }

  async updateWorkspaceOperationById(
    id: string,
    userId: string,
    updates: {
      status: WorkspaceOperation["status"];
      resultJson?: string | null;
      error?: string | null;
    },
  ): Promise<void> {
    await this.run(
      `UPDATE workspace_operations
       SET status = ?, result_json = ?, error = ?
       WHERE id = ? AND user_id = ?`,
      [
        updates.status,
        updates.resultJson ?? null,
        updates.error ?? null,
        id,
        userId,
      ],
    );
  }

  async enqueueWorkspaceEvent(
    event: Omit<WorkspaceEventOutbox, "createdAt">,
  ): Promise<void> {
    await this.run(
      `INSERT INTO workspace_events_outbox
       (event_id, user_id, event_type, run_id, rev_id, payload_json, published_at, delivery_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         user_id = excluded.user_id,
         event_type = excluded.event_type,
         run_id = excluded.run_id,
         rev_id = excluded.rev_id,
         payload_json = excluded.payload_json,
         published_at = excluded.published_at,
         delivery_status = excluded.delivery_status`,
      [
        event.eventId,
        event.userId || "default-user",
        event.eventType,
        event.runId,
        event.revId,
        event.payloadJson,
        event.publishedAt ? event.publishedAt.toISOString() : null,
        event.deliveryStatus,
      ],
    );
  }

  async getPendingWorkspaceEvents(
    limit: number = 50,
  ): Promise<WorkspaceEventOutbox[]> {
    const rows = await this.all(
      `SELECT * FROM workspace_events_outbox
       WHERE delivery_status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
      [limit],
    );

    return rows.map((row) => ({
      eventId: row.event_id,
      eventType: row.event_type,
      userId: row.user_id,
      runId: row.run_id,
      revId: row.rev_id,
      payloadJson: row.payload_json,
      publishedAt: row.published_at
        ? parseSqliteDate(row.published_at)
        : undefined,
      deliveryStatus: row.delivery_status,
      createdAt: parseSqliteDate(row.created_at),
    }));
  }

  async markWorkspaceEventPublished(eventId: string): Promise<void> {
    await this.run(
      `UPDATE workspace_events_outbox
       SET delivery_status = 'published', published_at = datetime('now')
       WHERE event_id = ?`,
      [eventId],
    );
  }

  async markWorkspaceEventFailed(eventId: string): Promise<void> {
    await this.run(
      `UPDATE workspace_events_outbox
       SET delivery_status = 'failed'
       WHERE event_id = ?`,
      [eventId],
    );
  }

  // Agent instance methods
  async saveInstance(instance: AgentInstance): Promise<void> {
    const userId = instance.userId || "default-user";
    await this.run(
      `INSERT OR REPLACE INTO agent_instances
       (id, user_id, repository_id, worktree_id, agent_type, status, pid, port, error_message, last_activity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        instance.id,
        userId,
        instance.repositoryId,
        instance.worktreeId,
        instance.agentType,
        instance.status,
        instance.pid || null,
        instance.port || null,
        instance.errorMessage || null,
        instance.lastActivity
          ? new Date(instance.lastActivity).toISOString()
          : null,
      ],
    );
  }

  async getInstance(
    id: string,
    userId?: string,
  ): Promise<AgentInstance | null> {
    const query = userId
      ? "SELECT * FROM agent_instances WHERE id = ? AND user_id = ?"
      : "SELECT * FROM agent_instances WHERE id = ?";
    const params = userId ? [id, userId] : [id];
    const row = await this.get(query, params);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      repositoryId: row.repository_id,
      worktreeId: row.worktree_id,
      agentType: row.agent_type,
      status: row.status,
      pid: row.pid || undefined,
      port: row.port || undefined,
      errorMessage: row.error_message || undefined,
      createdAt: new Date(row.created_at),
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined,
    };
  }

  async getAllInstances(userId?: string): Promise<AgentInstance[]> {
    const query = userId
      ? "SELECT * FROM agent_instances WHERE user_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM agent_instances ORDER BY created_at DESC";
    const params = userId ? [userId] : [];
    const rows = await this.all(query, params);

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      repositoryId: row.repository_id,
      worktreeId: row.worktree_id,
      agentType: row.agent_type,
      status: row.status,
      pid: row.pid || undefined,
      port: row.port || undefined,
      errorMessage: row.error_message || undefined,
      createdAt: new Date(row.created_at),
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined,
    }));
  }

  async getInstancesByRepository(
    repositoryId: string,
    userId?: string,
  ): Promise<AgentInstance[]> {
    const query = userId
      ? "SELECT * FROM agent_instances WHERE repository_id = ? AND user_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM agent_instances WHERE repository_id = ? ORDER BY created_at DESC";
    const params = userId ? [repositoryId, userId] : [repositoryId];
    const rows = await this.all(query, params);

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      repositoryId: row.repository_id,
      worktreeId: row.worktree_id,
      agentType: row.agent_type,
      status: row.status,
      pid: row.pid || undefined,
      port: row.port || undefined,
      errorMessage: row.error_message || undefined,
      createdAt: new Date(row.created_at),
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined,
    }));
  }

  async getInstancesByWorktree(
    worktreeId: string,
    userId?: string,
  ): Promise<AgentInstance[]> {
    const query = userId
      ? "SELECT * FROM agent_instances WHERE worktree_id = ? AND user_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM agent_instances WHERE worktree_id = ? ORDER BY created_at DESC";
    const params = userId ? [worktreeId, userId] : [worktreeId];
    const rows = await this.all(query, params);

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      repositoryId: row.repository_id,
      worktreeId: row.worktree_id,
      agentType: row.agent_type,
      status: row.status,
      pid: row.pid || undefined,
      port: row.port || undefined,
      errorMessage: row.error_message || undefined,
      createdAt: new Date(row.created_at),
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined,
    }));
  }

  async deleteInstance(id: string): Promise<void> {
    await this.run("DELETE FROM agent_instances WHERE id = ?", [id]);
  }

  async updateInstanceStatus(
    id: string,
    status: AgentInstance["status"],
    pid?: number,
  ): Promise<void> {
    await this.run(
      `UPDATE agent_instances
       SET status = ?, pid = ?, last_activity = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, pid || null, id],
    );
  }

  async updateInstanceActivity(id: string): Promise<void> {
    await this.run(
      `UPDATE agent_instances
       SET last_activity = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id],
    );
  }

  // Cleanup methods
  async cleanupStoppedInstances(): Promise<void> {
    await this.run(
      `DELETE FROM agent_instances
       WHERE status IN ('stopped', 'error')
       AND datetime(updated_at) < datetime('now', '-1 hour')`,
    );
  }

  // Token Usage Statistics methods
  async saveTokenUsageSession(sessionData: {
    id: string;
    instanceId: string;
    worktreeId: string;
    repositoryId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    totalCostUsd?: number;
    sessionStart: Date;
    sessionEnd?: Date;
  }): Promise<void> {
    await this.run(
      `INSERT OR REPLACE INTO token_usage_sessions
       (id, instance_id, worktree_id, repository_id, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, total_cost_usd, session_start, session_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionData.id,
        sessionData.instanceId,
        sessionData.worktreeId,
        sessionData.repositoryId,
        sessionData.inputTokens,
        sessionData.outputTokens,
        sessionData.cacheReadTokens || 0,
        sessionData.cacheCreationTokens || 0,
        sessionData.totalCostUsd || 0,
        sessionData.sessionStart.toISOString(),
        sessionData.sessionEnd ? sessionData.sessionEnd.toISOString() : null,
      ],
    );
  }

  async updateInstanceUsageSummary(
    instanceId: string,
    usage: {
      worktreeId: string;
      repositoryId: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      totalCostUsd?: number;
    },
  ): Promise<void> {
    // Get current summary or create new one
    const current = await this.get(
      "SELECT * FROM instance_usage_summary WHERE instance_id = ?",
      [instanceId],
    );

    if (current) {
      // Update existing summary
      await this.run(
        `UPDATE instance_usage_summary
         SET total_input_tokens = total_input_tokens + ?,
             total_output_tokens = total_output_tokens + ?,
             total_cache_read_tokens = total_cache_read_tokens + ?,
             total_cache_creation_tokens = total_cache_creation_tokens + ?,
             total_cost_usd = total_cost_usd + ?,
             session_count = session_count + 1,
             last_usage = CURRENT_TIMESTAMP
         WHERE instance_id = ?`,
        [
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens || 0,
          usage.cacheCreationTokens || 0,
          usage.totalCostUsd || 0,
          instanceId,
        ],
      );
    } else {
      // Create new summary
      await this.run(
        `INSERT INTO instance_usage_summary
         (instance_id, worktree_id, repository_id, total_input_tokens, total_output_tokens,
          total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd,
          session_count, first_usage, last_usage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          instanceId,
          usage.worktreeId,
          usage.repositoryId,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens || 0,
          usage.cacheCreationTokens || 0,
          usage.totalCostUsd || 0,
        ],
      );
    }
  }

  async updateDailyUsageStats(
    date: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      totalCostUsd?: number;
    },
  ): Promise<void> {
    const existing = await this.get(
      "SELECT * FROM daily_usage_stats WHERE date = ?",
      [date],
    );

    if (existing) {
      // Update existing daily stats
      await this.run(
        `UPDATE daily_usage_stats
         SET total_input_tokens = total_input_tokens + ?,
             total_output_tokens = total_output_tokens + ?,
             total_cache_read_tokens = total_cache_read_tokens + ?,
             total_cache_creation_tokens = total_cache_creation_tokens + ?,
             total_cost_usd = total_cost_usd + ?
         WHERE date = ?`,
        [
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens || 0,
          usage.cacheCreationTokens || 0,
          usage.totalCostUsd || 0,
          date,
        ],
      );
    } else {
      // Create new daily stats
      await this.run(
        `INSERT INTO daily_usage_stats
         (date, total_input_tokens, total_output_tokens, total_cache_read_tokens,
          total_cache_creation_tokens, total_cost_usd, session_count, active_instances)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
        [
          date,
          usage.inputTokens,
          usage.outputTokens,
          usage.cacheReadTokens || 0,
          usage.cacheCreationTokens || 0,
          usage.totalCostUsd || 0,
        ],
      );
    }
  }

  async getDailyUsageStats(days: number = 7): Promise<any[]> {
    return await this.all(
      `SELECT * FROM daily_usage_stats
       WHERE date >= date('now', '-' || ? || ' days')
       ORDER BY date ASC`,
      [days],
    );
  }

  async getInstanceUsageSummary(instanceId?: string): Promise<any[]> {
    if (instanceId) {
      const result = await this.get(
        "SELECT * FROM instance_usage_summary WHERE instance_id = ?",
        [instanceId],
      );
      return result ? [result] : [];
    }

    return await this.all(
      `SELECT ius.*, ai.status, ai.last_activity, ai.agent_type
       FROM instance_usage_summary ius
       LEFT JOIN agent_instances ai ON ius.instance_id = ai.id
       ORDER BY ius.last_usage DESC`,
    );
  }

  async getTotalUsageStats(): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalSessions: number;
    totalCost: number;
  }> {
    const result = await this.get(
      `SELECT
         COALESCE(SUM(total_input_tokens + total_cache_read_tokens + total_cache_creation_tokens), 0) as totalInputTokens,
         COALESCE(SUM(total_output_tokens), 0) as totalOutputTokens,
         COALESCE(SUM(session_count), 0) as totalSessions,
         COALESCE(SUM(total_cost_usd), 0) as totalCost
       FROM instance_usage_summary`,
    );

    return {
      totalInputTokens: result?.totalInputTokens || 0,
      totalOutputTokens: result?.totalOutputTokens || 0,
      totalSessions: result?.totalSessions || 0,
      totalCost: result?.totalCost || 0,
    };
  }

  async cleanupOldTokenUsage(daysToKeep: number = 30): Promise<void> {
    // Clean up old session data but keep daily aggregates
    await this.run(
      `DELETE FROM token_usage_sessions
       WHERE session_start < date('now', '-' || ? || ' days')`,
      [daysToKeep],
    );
  }

  // Database administration methods
  async getAllTables(): Promise<string[]> {
    const result = await this.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return result.map((row) => row.name);
  }

  async getTableSchema(tableName: string): Promise<any[]> {
    return await this.all(`PRAGMA table_info(${tableName})`);
  }

  async getTableData(
    tableName: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<any[]> {
    return await this.all(`SELECT * FROM ${tableName} LIMIT ? OFFSET ?`, [
      limit,
      offset,
    ]);
  }

  async getTableCount(tableName: string): Promise<number> {
    const result = await this.get(`SELECT COUNT(*) as count FROM ${tableName}`);
    return result.count;
  }

  async executeQuery(sql: string): Promise<any[]> {
    return await this.all(sql);
  }

  async deleteRows(tableName: string, whereClause: string): Promise<number> {
    const result = await this.run(
      `DELETE FROM ${tableName} WHERE ${whereClause}`,
    );
    return result.changes || 0;
  }

  async updateRows(
    tableName: string,
    setClause: string,
    whereClause: string,
  ): Promise<number> {
    const result = await this.run(
      `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`,
    );
    return result.changes || 0;
  }

  close(): void {
    this.db.close();
  }
}
