import { beforeEach, describe, expect, it, vi } from "vitest";

import type { db } from "@bob/db/client";
import type { WorkflowStatus } from "../workflowStatusService";
import {
  getSessionWorkflowState,
  workflowStatusValues,
} from "../workflowStatusService";

type MockConversationRow = Awaited<
  ReturnType<typeof db.query.chatConversations.findFirst>
>;

// Held as standalone references (rather than accessed off `db.*` at call
// sites) so vi.mocked()/assertions never read an unbound method off the
// mock object — sidesteps @typescript-eslint/unbound-method entirely.
// vi.hoisted() so these are safely initialized before the hoisted vi.mock
// factory below references them.
const { findFirstMock, executeMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn<() => Promise<MockConversationRow | undefined>>(),
  executeMock: vi.fn(),
}));

vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      chatConversations: {
        findFirst: findFirstMock,
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    execute: executeMock,
  },
}));

vi.mock("@bob/db", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => ({ field: a, value: b })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

describe("workflowStatusService", () => {
  beforeEach(() => {
    executeMock.mockReset();
    findFirstMock.mockReset();
  });

  describe("workflowStatusValues", () => {
    it("should contain all valid workflow status values", () => {
      expect(workflowStatusValues).toContain("started");
      expect(workflowStatusValues).toContain("working");
      expect(workflowStatusValues).toContain("awaiting_input");
      expect(workflowStatusValues).toContain("blocked");
      expect(workflowStatusValues).toContain("awaiting_review");
      expect(workflowStatusValues).toContain("completed");
    });

    it("should have exactly 6 status values", () => {
      expect(workflowStatusValues.length).toBe(6);
    });
  });

  describe("state machine transitions", () => {
    const validTransitions: Record<WorkflowStatus, WorkflowStatus[]> = {
      started: ["working"],
      working: ["awaiting_input", "blocked", "awaiting_review", "completed"],
      awaiting_input: ["working"],
      blocked: ["working"],
      awaiting_review: ["working", "completed"],
      completed: [],
    };

    it("should define valid transitions from started", () => {
      expect(validTransitions.started).toEqual(["working"]);
    });

    it("should define valid transitions from working", () => {
      expect(validTransitions.working).toContain("awaiting_input");
      expect(validTransitions.working).toContain("blocked");
      expect(validTransitions.working).toContain("awaiting_review");
      expect(validTransitions.working).toContain("completed");
    });

    it("should only allow awaiting_input to transition to working", () => {
      expect(validTransitions.awaiting_input).toEqual(["working"]);
    });

    it("should only allow blocked to transition to working", () => {
      expect(validTransitions.blocked).toEqual(["working"]);
    });

    it("should allow awaiting_review to transition to working or completed", () => {
      expect(validTransitions.awaiting_review).toContain("working");
      expect(validTransitions.awaiting_review).toContain("completed");
    });

    it("should not allow any transitions from completed", () => {
      expect(validTransitions.completed).toEqual([]);
    });
  });

  describe("type safety", () => {
    it("should ensure WorkflowStatus type matches workflowStatusValues", () => {
      const testStatus: WorkflowStatus = "working";
      expect(workflowStatusValues).toContain(testStatus);
    });
  });

  describe("getSessionWorkflowState", () => {
    it("reads workflow state from the owned conversation row", async () => {
      findFirstMock.mockResolvedValueOnce({
        userId: "user-1",
        workflowStatus: "started",
        statusMessage: "Queued for execution",
        awaitingInputQuestion: null,
        awaitingInputOptions: null,
        awaitingInputDefault: null,
        awaitingInputExpiresAt: null,
      } as MockConversationRow);

      await expect(
        getSessionWorkflowState("user-1", "session-1"),
      ).resolves.toEqual({
        workflowStatus: "started",
        statusMessage: "Queued for execution",
        awaitingInput: null,
      });
      expect(executeMock).not.toHaveBeenCalled();
    });

    it("does not fail through the raw execute path in production", async () => {
      executeMock.mockRejectedValueOnce(
        new TypeError("Cannot read properties of undefined (reading 'length')"),
      );
      findFirstMock.mockResolvedValueOnce({
        userId: "user-1",
        workflowStatus: "awaiting_input",
        statusMessage: "Need a decision",
        awaitingInputQuestion: "Proceed?",
        awaitingInputOptions: ["yes", "no"],
        awaitingInputDefault: "yes",
        awaitingInputExpiresAt: "2026-05-30T12:00:00.000Z",
      } as MockConversationRow);

      await expect(
        getSessionWorkflowState("user-1", "session-1"),
      ).resolves.toEqual({
        workflowStatus: "awaiting_input",
        statusMessage: "Need a decision",
        awaitingInput: {
          question: "Proceed?",
          options: ["yes", "no"],
          defaultAction: "yes",
          expiresAt: "2026-05-30T12:00:00.000Z",
        },
      });
    });
  });
});

describe("workflowStatusService state machine validation", () => {
  function isValidTransition(
    from: WorkflowStatus,
    to: WorkflowStatus,
  ): boolean {
    const validTransitions: Record<WorkflowStatus, WorkflowStatus[]> = {
      started: ["working"],
      working: ["awaiting_input", "blocked", "awaiting_review", "completed"],
      awaiting_input: ["working"],
      blocked: ["working"],
      awaiting_review: ["working", "completed"],
      completed: [],
    };
    // validTransitions is a Record covering every WorkflowStatus key, so the
    // lookup is always defined — no optional chain / fallback needed.
    return validTransitions[from].includes(to);
  }

  describe("valid transitions", () => {
    it("should allow started -> working", () => {
      expect(isValidTransition("started", "working")).toBe(true);
    });

    it("should allow working -> awaiting_input", () => {
      expect(isValidTransition("working", "awaiting_input")).toBe(true);
    });

    it("should allow working -> blocked", () => {
      expect(isValidTransition("working", "blocked")).toBe(true);
    });

    it("should allow working -> awaiting_review", () => {
      expect(isValidTransition("working", "awaiting_review")).toBe(true);
    });

    it("should allow working -> completed", () => {
      expect(isValidTransition("working", "completed")).toBe(true);
    });

    it("should allow awaiting_input -> working", () => {
      expect(isValidTransition("awaiting_input", "working")).toBe(true);
    });

    it("should allow blocked -> working", () => {
      expect(isValidTransition("blocked", "working")).toBe(true);
    });

    it("should allow awaiting_review -> working", () => {
      expect(isValidTransition("awaiting_review", "working")).toBe(true);
    });

    it("should allow awaiting_review -> completed", () => {
      expect(isValidTransition("awaiting_review", "completed")).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("should not allow started -> completed directly", () => {
      expect(isValidTransition("started", "completed")).toBe(false);
    });

    it("should not allow started -> awaiting_input directly", () => {
      expect(isValidTransition("started", "awaiting_input")).toBe(false);
    });

    it("should not allow completed -> any state", () => {
      expect(isValidTransition("completed", "started")).toBe(false);
      expect(isValidTransition("completed", "working")).toBe(false);
      expect(isValidTransition("completed", "awaiting_input")).toBe(false);
      expect(isValidTransition("completed", "blocked")).toBe(false);
      expect(isValidTransition("completed", "awaiting_review")).toBe(false);
    });

    it("should not allow awaiting_input -> completed directly", () => {
      expect(isValidTransition("awaiting_input", "completed")).toBe(false);
    });

    it("should not allow blocked -> completed directly", () => {
      expect(isValidTransition("blocked", "completed")).toBe(false);
    });
  });
});

describe("awaiting input timeout calculation", () => {
  it("should calculate default 30 minute timeout", () => {
    const timeoutMinutes = 30;
    const now = Date.now();
    const expiresAt = new Date(now + timeoutMinutes * 60 * 1000);

    expect(expiresAt.getTime() - now).toBeCloseTo(30 * 60 * 1000, -2);
  });

  it("should calculate custom timeout", () => {
    const timeoutMinutes = 60;
    const now = Date.now();
    const expiresAt = new Date(now + timeoutMinutes * 60 * 1000);

    expect(expiresAt.getTime() - now).toBeCloseTo(60 * 60 * 1000, -2);
  });

  it("should use default timeout when not specified", () => {
    // Returned through a function typed `number | undefined` (rather than a
    // literal `undefined`) so TS can't statically narrow the `??` fallback
    // away — this actually exercises the runtime default-application path.
    const readUnspecifiedTimeout = (): number | undefined => undefined;
    const optionalTimeout = readUnspecifiedTimeout();
    const timeoutMinutes = optionalTimeout ?? 30;
    expect(timeoutMinutes).toBe(30);
  });
});

describe("resolution types", () => {
  it("should support human resolution type", () => {
    const resolution = { type: "human" as const, value: "User response" };
    expect(resolution.type).toBe("human");
    expect(resolution.value).toBe("User response");
  });

  it("should support timeout resolution type", () => {
    const resolution = {
      type: "timeout" as const,
      value: "Default action taken",
    };
    expect(resolution.type).toBe("timeout");
    expect(resolution.value).toBe("Default action taken");
  });
});
