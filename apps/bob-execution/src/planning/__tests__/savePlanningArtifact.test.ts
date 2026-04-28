import { describe, expect, it, vi, beforeEach } from "vitest";

const findFirstMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();

vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      workItemArtifacts: {
        findFirst: (...args: unknown[]) => findFirstMock(...args),
      },
    },
    insert: () => ({
      values: (...args: unknown[]) => {
        insertValuesMock(...args);
        return {
          returning: () =>
            insertReturningMock(),
        };
      },
    }),
    update: () => ({
      set: (...args: unknown[]) => {
        updateSetMock(...args);
        return {
          where: (...whereArgs: unknown[]) => {
            updateWhereMock(...whereArgs);
            return {
              returning: () => updateReturningMock(),
            };
          },
        };
      },
    }),
  },
}));

vi.mock("@bob/db", () => ({
  and: (...clauses: unknown[]) => ({ type: "and", clauses }),
  eq: (field: unknown, value: unknown) => ({ type: "eq", field, value }),
}));

vi.mock("@bob/db/schema", () => ({
  workItemArtifacts: {
    workItemId: "workItemId",
    producerType: "producerType",
    producerId: "producerId",
    artifactRole: "artifactRole",
    artifactType: "artifactType",
    isCurrent: "isCurrent",
    id: "id",
  },
}));

import { savePlanningArtifact } from "../savePlanningArtifact";

describe("savePlanningArtifact", () => {
  const baseInput = {
    sessionId: "sess-123",
    workItemId: "wi-456",
    artifactType: "planning_doc" as const,
    title: "Implementation Plan",
    content: "# Plan\n\nDo the thing.",
    summary: "A plan to do the thing",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new artifact when none exists", async () => {
    findFirstMock.mockResolvedValue(null);
    insertReturningMock.mockResolvedValue([
      { id: "artifact-new", isCurrent: true },
    ]);

    const result = await savePlanningArtifact(baseInput);

    expect(result).toEqual({ id: "artifact-new", created: true });
    expect(findFirstMock).toHaveBeenCalledOnce();
    expect(insertValuesMock).toHaveBeenCalledOnce();

    const insertedValues = insertValuesMock.mock.calls[0]![0];
    expect(insertedValues).toMatchObject({
      workItemId: "wi-456",
      sessionId: "sess-123",
      producerType: "bob",
      artifactType: "planning_doc",
      artifactRole: "documentation",
      title: "Implementation Plan",
      content: "# Plan\n\nDo the thing.",
      summary: "A plan to do the thing",
      isCurrent: true,
    });
  });

  it("updates existing artifact when one matches", async () => {
    findFirstMock.mockResolvedValue({
      id: "artifact-existing",
      summary: "Old summary",
    });

    const result = await savePlanningArtifact(baseInput);

    expect(result).toEqual({ id: "artifact-existing", created: false });
    expect(updateSetMock).toHaveBeenCalledWith({
      title: "Implementation Plan",
      content: "# Plan\n\nDo the thing.",
      summary: "A plan to do the thing",
    });
    // Should not insert
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("preserves existing summary when no summary is provided on update", async () => {
    findFirstMock.mockResolvedValue({
      id: "artifact-existing",
      summary: "Existing summary",
    });

    const { summary: _summary, ...inputWithoutSummary } = baseInput;

    const result = await savePlanningArtifact(inputWithoutSummary);

    expect(result).toEqual({ id: "artifact-existing", created: false });
    expect(updateSetMock).toHaveBeenCalledWith({
      title: "Implementation Plan",
      content: "# Plan\n\nDo the thing.",
      summary: "Existing summary",
    });
  });

  it("produces a deterministic producerId for same inputs", async () => {
    findFirstMock.mockResolvedValue(null);
    insertReturningMock.mockResolvedValue([{ id: "a1" }]);

    await savePlanningArtifact(baseInput);

    const firstProducerId =
      (findFirstMock.mock.calls[0]![0] as Record<string, unknown>);

    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(null);
    insertReturningMock.mockResolvedValue([{ id: "a2" }]);

    await savePlanningArtifact(baseInput);

    const secondProducerId =
      (findFirstMock.mock.calls[0]![0] as Record<string, unknown>);

    // The where clause should be identical for the same inputs
    expect(firstProducerId).toEqual(secondProducerId);
  });
});
