import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PgliteDbHandle } from "@bob/db/client-pglite";
import { eq } from "@bob/db";
import { makePgliteDb } from "@bob/db/client-pglite";
import { taskRuns, user } from "@bob/db/schema";

import type { FoundationRunCompletion } from "../foundationFulfillmentService.js";
import { reconcileRunFoundationCompletion } from "../foundationFulfillmentService.js";

describe("Foundation completion reconciliation", () => {
  let handle: PgliteDbHandle;
  const authorized = { userId: "foundation-owner", workspaceId: "workspace" };

  beforeAll(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:" });
    await handle.db.insert(user).values({
      id: authorized.userId,
      name: "Owner",
      email: "foundation-owner@example.test",
    });
  }, 30_000);
  afterAll(async () => {
    await handle.close();
  });

  async function createRun(
    overrides: Partial<typeof taskRuns.$inferInsert> = {},
  ) {
    const id = randomUUID();
    await handle.db.insert(taskRuns).values({
      id,
      userId: authorized.userId,
      planningWorkspaceId: authorized.workspaceId,
      planningItemId: "issue",
      planningItemIdentifier: "TEST-1",
      sessionId: randomUUID(),
      status: "completed",
      completedAt: "2026-01-01T01:00:00+01:00",
      ...overrides,
    });
    return id;
  }

  function adapter() {
    return {
      recordCompletion: vi
        .fn<FoundationRunCompletion["recordCompletion"]>()
        .mockResolvedValue({ fulfillmentEndId: "end", runLinkId: "link" }),
    };
  }

  it("uses persisted facts and leaves the task run unchanged on retries", async () => {
    const id = await createRun();
    const before = await handle.db.query.taskRuns.findFirst({
      where: eq(taskRuns.id, id),
    });
    const foundation = adapter();
    const first = await reconcileRunFoundationCompletion(
      handle.db,
      authorized,
      id,
      foundation,
    );
    const second = await reconcileRunFoundationCompletion(
      handle.db,
      authorized,
      id,
      foundation,
    );
    expect(first).toEqual({ fulfillmentEndId: "end", runLinkId: "link" });
    expect(second).toEqual(first);
    expect(foundation.recordCompletion).toHaveBeenCalledTimes(2);
    expect(foundation.recordCompletion).toHaveBeenNthCalledWith(1, {
      taskRunId: id,
      userId: authorized.userId,
      workspaceId: authorized.workspaceId,
      planningItemId: "issue",
      sessionId: before?.sessionId,
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(foundation.recordCompletion.mock.calls[1]).toEqual(
      foundation.recordCompletion.mock.calls[0],
    );
    expect(
      await handle.db.query.taskRuns.findFirst({ where: eq(taskRuns.id, id) }),
    ).toEqual(before);
  });

  it.each(["user", "workspace", "missing"])(
    "rejects %s mismatches before publishing",
    async (mismatch) => {
      const id = await createRun();
      const foundation = adapter();
      const auth = {
        userId: mismatch === "user" ? "another-user" : authorized.userId,
        workspaceId:
          mismatch === "workspace"
            ? "another-workspace"
            : authorized.workspaceId,
      };
      await expect(
        reconcileRunFoundationCompletion(
          handle.db,
          auth,
          mismatch === "missing" ? randomUUID() : id,
          foundation,
        ),
      ).rejects.toThrow("authorized workspace");
      expect(foundation.recordCompletion).not.toHaveBeenCalled();
    },
  );

  it.each(["starting", "running", "blocked", "failed"])(
    "rejects %s runs",
    async (status) => {
      const id = await createRun({ status });
      const foundation = adapter();
      await expect(
        reconcileRunFoundationCompletion(handle.db, authorized, id, foundation),
      ).rejects.toThrow("persisted completed run");
      expect(foundation.recordCompletion).not.toHaveBeenCalled();
    },
  );

  it.each([{ sessionId: null }, { completedAt: null }, { planningItemId: "" }])(
    "rejects incomplete persisted facts: %j",
    async (fields) => {
      const id = await createRun(fields);
      const foundation = adapter();
      await expect(
        reconcileRunFoundationCompletion(handle.db, authorized, id, foundation),
      ).rejects.toThrow("persisted completed run");
      expect(foundation.recordCompletion).not.toHaveBeenCalled();
    },
  );

  it("propagates adapter failures and retries only reconciliation", async () => {
    const id = await createRun();
    const foundation = adapter();
    foundation.recordCompletion.mockRejectedValueOnce(
      new Error("Foundation unavailable"),
    );
    await expect(
      reconcileRunFoundationCompletion(handle.db, authorized, id, foundation),
    ).rejects.toThrow("Foundation unavailable");
    await expect(
      reconcileRunFoundationCompletion(handle.db, authorized, id, foundation),
    ).resolves.toEqual({ fulfillmentEndId: "end", runLinkId: "link" });
    expect(foundation.recordCompletion.mock.calls[1]).toEqual(
      foundation.recordCompletion.mock.calls[0],
    );
    expect(
      (await handle.db.query.taskRuns.findFirst({ where: eq(taskRuns.id, id) }))
        ?.status,
    ).toBe("completed");
  });
});
