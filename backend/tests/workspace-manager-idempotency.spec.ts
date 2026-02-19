import { describe, expect, it } from "vitest";

import {
  WorkspaceManagerDb,
  WorkspaceManagerRepoLookup,
  WorkspaceManagerService,
} from "../src/services/workspace-manager";
import {
  WorkspaceEventOutbox,
  WorkspaceOperation,
  WorkspaceRun,
} from "../src/types";

class FakeDb implements WorkspaceManagerDb {
  private opsById = new Map<string, WorkspaceOperation>();
  private opIndex = new Map<string, string>();

  private keyFor(
    userId: string,
    runId: string,
    operation: string,
    key: string,
  ) {
    return `${userId}|${runId}|${operation}|${key}`;
  }

  async getWorkspaceRun(
    _runId: string,
    _userId?: string,
  ): Promise<WorkspaceRun | null> {
    return null;
  }

  async saveWorkspaceRun(
    _runData: Omit<WorkspaceRun, "createdAt" | "updatedAt">,
  ): Promise<void> {
    throw new Error("not implemented");
  }

  async updateWorkspaceRun(
    _runId: string,
    _userId: string | undefined,
    _updates: Partial<{
      headRev: string;
      status: WorkspaceRun["status"];
      testStatus: string | null;
      error: string | null;
    }>,
  ): Promise<void> {
    throw new Error("not implemented");
  }

  async deleteWorkspaceRun(_runId: string, _userId?: string): Promise<void> {
    throw new Error("not implemented");
  }

  async findWorkspaceOperation(
    userId: string,
    runId: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<WorkspaceOperation | null> {
    const idx = this.keyFor(userId, runId, operation, idempotencyKey);
    const id = this.opIndex.get(idx);
    if (!id) return null;
    return this.opsById.get(id) || null;
  }

  async createWorkspaceOperation(
    operation: Omit<WorkspaceOperation, "createdAt" | "updatedAt">,
  ): Promise<void> {
    const userId = operation.userId || "default-user";
    const idx = this.keyFor(
      userId,
      operation.runId,
      operation.operation,
      operation.idempotencyKey,
    );
    if (this.opIndex.has(idx)) {
      throw new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed");
    }

    const now = new Date();
    this.opIndex.set(idx, operation.id);
    this.opsById.set(operation.id, {
      ...operation,
      userId,
      createdAt: now,
      updatedAt: now,
    });
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
    const existing = this.opsById.get(id);
    if (!existing) return;
    if ((existing.userId || "default-user") !== userId) return;

    this.opsById.set(id, {
      ...existing,
      status: updates.status,
      resultJson: updates.resultJson ?? undefined,
      error: updates.error ?? undefined,
      updatedAt: new Date(),
    });
  }

  async enqueueWorkspaceEvent(
    _event: Omit<WorkspaceEventOutbox, "createdAt">,
  ): Promise<void> {
    throw new Error("not implemented");
  }
}

const fakeRepoLookup: WorkspaceManagerRepoLookup = {
  getRepository: () => ({}),
};

describe("WorkspaceManagerService idempotency", () => {
  it("creates a new operation when none exists", async () => {
    const db = new FakeDb();
    const svc = new WorkspaceManagerService(db, fakeRepoLookup);

    const { operation, alreadyExisted } = await svc.getOrCreateOperation(
      "run_1",
      "apply_patch",
      "key_1",
      "hash_1",
      "user_a",
    );

    expect(alreadyExisted).toBe(false);
    expect(operation.userId).toBe("user_a");
    expect(operation.status).toBe("running");
  });

  it("returns cached succeeded operation when resultJson is present", async () => {
    const db = new FakeDb();
    const svc = new WorkspaceManagerService(db, fakeRepoLookup);

    const created = await svc.getOrCreateOperation(
      "run_1",
      "apply_patch",
      "key_1",
      "hash_1",
      "user_a",
    );

    await svc.finalizeOperation(created.operation, "succeeded", { ok: true });

    const replay = await svc.getOrCreateOperation(
      "run_1",
      "apply_patch",
      "key_1",
      "hash_1",
      "user_a",
    );

    expect(replay.alreadyExisted).toBe(true);
    expect(JSON.parse(replay.operation.resultJson || "{}")).toEqual({
      ok: true,
    });
  });

  it("rejects same idempotency key with different payload hash", async () => {
    const db = new FakeDb();
    const svc = new WorkspaceManagerService(db, fakeRepoLookup);

    await svc.getOrCreateOperation(
      "run_1",
      "apply_patch",
      "key_1",
      "hash_1",
      "user_a",
    );

    await expect(
      svc.getOrCreateOperation(
        "run_1",
        "apply_patch",
        "key_1",
        "hash_2",
        "user_a",
      ),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });

  it("rejects replay while operation is running", async () => {
    const db = new FakeDb();
    const svc = new WorkspaceManagerService(db, fakeRepoLookup);

    await svc.getOrCreateOperation(
      "run_1",
      "apply_patch",
      "key_1",
      "hash_1",
      "user_a",
    );

    await expect(
      svc.getOrCreateOperation(
        "run_1",
        "apply_patch",
        "key_1",
        "hash_1",
        "user_a",
      ),
    ).rejects.toThrow("IDEMPOTENCY_IN_PROGRESS");
  });

  it("rejects replay after operation failed", async () => {
    const db = new FakeDb();
    const svc = new WorkspaceManagerService(db, fakeRepoLookup);

    const created = await svc.getOrCreateOperation(
      "run_1",
      "apply_patch",
      "key_1",
      "hash_1",
      "user_a",
    );
    await svc.finalizeOperation(created.operation, "failed", undefined, "boom");

    await expect(
      svc.getOrCreateOperation(
        "run_1",
        "apply_patch",
        "key_1",
        "hash_1",
        "user_a",
      ),
    ).rejects.toThrow("IDEMPOTENCY_PREVIOUSLY_FAILED");
  });

  it("scopes idempotency by userId", async () => {
    const db = new FakeDb();
    const svc = new WorkspaceManagerService(db, fakeRepoLookup);

    const a = await svc.getOrCreateOperation(
      "run_1",
      "apply_patch",
      "key_1",
      "hash_1",
      "user_a",
    );
    const b = await svc.getOrCreateOperation(
      "run_1",
      "apply_patch",
      "key_1",
      "hash_1",
      "user_b",
    );

    expect(a.operation.id).not.toBe(b.operation.id);
    expect(a.operation.userId).toBe("user_a");
    expect(b.operation.userId).toBe("user_b");
  });
});
