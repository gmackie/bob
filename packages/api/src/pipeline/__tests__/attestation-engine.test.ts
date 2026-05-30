import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureAttestations } from "../attestation-engine";

const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertOnConflictDoNothingMock = vi.fn();

const makeDbMock = () => ({
  insert: (table: unknown) => {
    dbInsertMock(table);
    return {
      values: (values: unknown) => {
        dbInsertValuesMock(values);
        return {
          onConflictDoNothing: (opts: unknown) => {
            dbInsertOnConflictDoNothingMock(opts);
            return Promise.resolve();
          },
        };
      },
    };
  },
});

describe("ensureAttestations", () => {
  beforeEach(() => {
    dbInsertMock.mockReset();
    dbInsertValuesMock.mockReset();
    dbInsertOnConflictDoNothingMock.mockReset();
  });

  it("creates pending rows for required attestations", async () => {
    await ensureAttestations(makeDbMock() as any, {
      revisionId: "revision-1",
      repoId: "repo-1",
      taskId: "task-1",
      executionPolicy: {
        requiredAttestations: ["security-review", "test-evidence"],
      },
    });

    expect(dbInsertValuesMock).toHaveBeenCalledWith([
      {
        revisionId: "revision-1",
        repoId: "repo-1",
        taskId: "task-1",
        kind: "security-review",
        status: "pending",
      },
      {
        revisionId: "revision-1",
        repoId: "repo-1",
        taskId: "task-1",
        kind: "test-evidence",
        status: "pending",
      },
    ]);
    expect(dbInsertOnConflictDoNothingMock).toHaveBeenCalledOnce();
  });

  it("deduplicates and ignores blank attestation names", async () => {
    await ensureAttestations(makeDbMock() as any, {
      revisionId: "revision-1",
      repoId: "repo-1",
      executionPolicy: {
        requiredAttestations: [" security-review ", "", "security-review"],
      },
    });

    expect(dbInsertValuesMock).toHaveBeenCalledWith([
      {
        revisionId: "revision-1",
        repoId: "repo-1",
        taskId: null,
        kind: "security-review",
        status: "pending",
      },
    ]);
  });

  it("does not write without required attestations", async () => {
    await ensureAttestations(makeDbMock() as any, {
      revisionId: "revision-1",
      repoId: "repo-1",
      executionPolicy: { requiredAttestations: [] },
    });

    expect(dbInsertMock).not.toHaveBeenCalled();
  });
});
