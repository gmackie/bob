import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

import {
  DEFAULT_USER_ID,
  WorkspaceEventOutbox,
  WorkspaceOperation,
  WorkspaceRun,
  WorkspaceRunStatus,
} from "../types.js";
import { getUserPathsService } from "./user-paths.js";

export interface WorkspaceManagerDb {
  getWorkspaceRun(runId: string, userId?: string): Promise<WorkspaceRun | null>;
  saveWorkspaceRun(
    runData: Omit<WorkspaceRun, "createdAt" | "updatedAt">,
  ): Promise<void>;
  updateWorkspaceRun(
    runId: string,
    userId: string | undefined,
    updates: Partial<{
      headRev: string;
      status: WorkspaceRunStatus;
      testStatus: string | null;
      error: string | null;
    }>,
  ): Promise<void>;
  deleteWorkspaceRun(runId: string, userId?: string): Promise<void>;
  findWorkspaceOperation(
    userId: string,
    runId: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<WorkspaceOperation | null>;
  createWorkspaceOperation(
    operation: Omit<WorkspaceOperation, "createdAt" | "updatedAt">,
  ): Promise<void>;
  updateWorkspaceOperationById(
    id: string,
    userId: string,
    updates: {
      status: WorkspaceOperation["status"];
      resultJson?: string | null;
      error?: string | null;
    },
  ): Promise<void>;
  enqueueWorkspaceEvent(
    event: Omit<WorkspaceEventOutbox, "createdAt">,
  ): Promise<void>;
}

export interface WorkspaceManagerRepoLookup {
  getRepository(repositoryId: string, userId?: string): unknown | null;
}

export interface CreateRunWorkspaceInput {
  taskId: string;
  runId: string;
  agentId: string;
  baseRef?: string;
}

export interface ApplyPatchInput {
  patch: string;
}

export interface DescribeChangesetInput {
  message: string;
}

export class WorkspaceManagerService {
  constructor(
    private db: WorkspaceManagerDb,
    private gitService: WorkspaceManagerRepoLookup,
  ) {}

  async createRunWorkspace(
    repositoryId: string,
    input: CreateRunWorkspaceInput,
    userId?: string,
  ): Promise<WorkspaceRun> {
    const effectiveUserId = userId || DEFAULT_USER_ID;
    const repository = this.gitService.getRepository(
      repositoryId,
      effectiveUserId,
    );
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    const existing = await this.db.getWorkspaceRun(
      input.runId,
      effectiveUserId,
    );
    if (existing) {
      return existing;
    }

    const userPathsService = getUserPathsService();
    userPathsService.ensureUserDirectories(effectiveUserId);
    const paths = userPathsService.getUserPaths(effectiveUserId);
    const workspaceBasePath = path.resolve(path.join(paths.base, "workspaces"));
    await fs.mkdir(workspaceBasePath, { recursive: true });
    const workspacePath = path.join(workspaceBasePath, `run-${input.runId}`);
    const resolvedWorkspacePath = path.resolve(workspacePath);
    const baseWithSep = `${workspaceBasePath}${path.sep}`;
    if (
      resolvedWorkspacePath !== workspaceBasePath &&
      !resolvedWorkspacePath.startsWith(baseWithSep)
    ) {
      throw new Error("Invalid workspace path");
    }
    await fs.mkdir(resolvedWorkspacePath, { recursive: true });

    const now = new Date();
    const run: WorkspaceRun = {
      runId: input.runId,
      userId: effectiveUserId,
      taskId: input.taskId,
      workspaceId: `ws_${input.runId}`,
      repositoryId,
      agentId: input.agentId,
      baseRev: input.baseRef || "base",
      headRev: input.baseRef || "base",
      workspacePath: resolvedWorkspacePath,
      status: "CREATED",
      testStatus: "not_started",
      createdAt: now,
      updatedAt: now,
    };

    await this.db.saveWorkspaceRun({
      runId: run.runId,
      userId: run.userId,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      repositoryId: run.repositoryId,
      agentId: run.agentId,
      baseRev: run.baseRev,
      headRev: run.headRev,
      workspacePath: run.workspacePath,
      status: run.status,
      testStatus: run.testStatus,
      error: run.error,
    });

    await this.db.updateWorkspaceRun(run.runId, effectiveUserId, {
      status: "MATERIALIZED",
    });

    await this.enqueueEvent(
      effectiveUserId,
      "run.created",
      run.runId,
      run.headRev,
      {
        task_id: run.taskId,
        workspace_id: run.workspaceId,
        repository_id: run.repositoryId,
        agent_id: run.agentId,
      },
    );

    return this.getRequiredRun(run.runId, effectiveUserId);
  }

  async getRunStatus(
    runId: string,
    userId?: string,
  ): Promise<WorkspaceRun | null> {
    const effectiveUserId = userId || DEFAULT_USER_ID;
    return this.db.getWorkspaceRun(runId, effectiveUserId);
  }

  async applyPatch(
    runId: string,
    input: ApplyPatchInput,
    userId?: string,
  ): Promise<WorkspaceRun> {
    const run = await this.getRequiredRun(runId, userId);
    const effectiveUserId = userId || DEFAULT_USER_ID;
    const nextHeadRev = `rev_${crypto.randomBytes(8).toString("hex")}`;

    await this.db.updateWorkspaceRun(runId, effectiveUserId, {
      headRev: nextHeadRev,
      status: "CODING",
    });

    await this.enqueueEvent(
      effectiveUserId,
      "rev.updated",
      runId,
      nextHeadRev,
      {
        patch_size: input.patch.length,
      },
    );

    const updated = await this.getRequiredRun(runId, userId);
    return updated;
  }

  async describeChangeset(
    runId: string,
    input: DescribeChangesetInput,
    userId?: string,
  ): Promise<WorkspaceRun> {
    const run = await this.getRequiredRun(runId, userId);
    const effectiveUserId = userId || DEFAULT_USER_ID;
    await this.enqueueEvent(
      effectiveUserId,
      "rev.described",
      runId,
      run.headRev,
      {
        message: input.message,
      },
    );
    return run;
  }

  async cleanupRun(runId: string, userId?: string): Promise<void> {
    const run = await this.getRequiredRun(runId, userId);
    const effectiveUserId = userId || DEFAULT_USER_ID;
    const userPathsService = getUserPathsService();
    const paths = userPathsService.getUserPaths(effectiveUserId);
    const workspaceBasePath = path.resolve(path.join(paths.base, "workspaces"));
    const resolvedWorkspacePath = path.resolve(run.workspacePath);
    const baseWithSep = `${workspaceBasePath}${path.sep}`;
    if (
      resolvedWorkspacePath !== workspaceBasePath &&
      !resolvedWorkspacePath.startsWith(baseWithSep)
    ) {
      throw new Error("Invalid workspace path");
    }

    await this.db.updateWorkspaceRun(runId, effectiveUserId, {
      status: "ABANDONED",
      error: null,
    });

    await fs.rm(resolvedWorkspacePath, { recursive: true, force: true });

    await this.enqueueEvent(
      effectiveUserId,
      "run.cleaned",
      runId,
      run.headRev,
      {
        workspace_id: run.workspaceId,
        workspace_path: run.workspacePath,
      },
    );
  }

  async getOrCreateOperation(
    runId: string,
    operationName: string,
    idempotencyKey: string,
    requestHash: string,
    userId?: string,
  ): Promise<{ operation: WorkspaceOperation; alreadyExisted: boolean }> {
    const effectiveUserId = userId || DEFAULT_USER_ID;

    const operation: WorkspaceOperation = {
      id: `wop_${crypto.randomBytes(10).toString("hex")}`,
      userId: effectiveUserId,
      runId,
      operation: operationName,
      idempotencyKey,
      requestHash,
      status: "running",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      await this.db.createWorkspaceOperation({
        id: operation.id,
        userId: operation.userId,
        runId: operation.runId,
        operation: operation.operation,
        idempotencyKey: operation.idempotencyKey,
        requestHash: operation.requestHash,
        status: operation.status,
        resultJson: operation.resultJson,
        error: operation.error,
      });
      return { operation, alreadyExisted: false };
    } catch (error) {
      const typedError = error as Error;
      const message = typedError?.message || "";
      const isConstraint = message.includes("SQLITE_CONSTRAINT");
      if (!isConstraint) {
        throw typedError;
      }

      const existing = await this.db.findWorkspaceOperation(
        effectiveUserId,
        runId,
        operationName,
        idempotencyKey,
      );
      if (!existing) {
        throw typedError;
      }
      if (existing.requestHash !== requestHash) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      if (existing.status === "succeeded" && existing.resultJson) {
        return { operation: existing, alreadyExisted: true };
      }
      if (existing.status === "failed") {
        throw new Error("IDEMPOTENCY_PREVIOUSLY_FAILED");
      }
      throw new Error("IDEMPOTENCY_IN_PROGRESS");
    }
  }

  async finalizeOperation(
    operation: WorkspaceOperation,
    status: WorkspaceOperation["status"],
    result?: unknown,
    error?: string,
  ): Promise<void> {
    const effectiveUserId = operation.userId || DEFAULT_USER_ID;
    await this.db.updateWorkspaceOperationById(operation.id, effectiveUserId, {
      status,
      resultJson: result ? JSON.stringify(result) : null,
      error: error ?? null,
    });
  }

  private async enqueueEvent(
    userId: string,
    eventType: string,
    runId: string,
    revId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.db.enqueueWorkspaceEvent({
      eventId: `evt_${crypto.randomBytes(12).toString("hex")}`,
      userId,
      eventType,
      runId,
      revId,
      payloadJson: JSON.stringify(payload),
      deliveryStatus: "pending",
    });
  }

  private async getRequiredRun(
    runId: string,
    userId?: string,
  ): Promise<WorkspaceRun> {
    const effectiveUserId = userId || DEFAULT_USER_ID;
    const run = await this.db.getWorkspaceRun(runId, effectiveUserId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
    return run;
  }

  static hashRequest(payload: unknown): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
  }

  static normalizeStatus(value: WorkspaceRunStatus): WorkspaceRunStatus {
    return value;
  }

  static isValidRunId(value: string): boolean {
    return /^[A-Za-z0-9._-]+$/.test(value);
  }
}
