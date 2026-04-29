import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolHandlerError } from "../handler";
import type { HandlerContext, ToolHandler } from "../handler";
import { withLogging } from "../middleware/logging";

const THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";
const LOG_ID = "22222222-2222-4222-a222-222222222222";
const RUNNER_ID = "33333333-3333-4333-a333-333333333333";

function makeCtx(overrides: Partial<HandlerContext> = {}): {
  ctx: HandlerContext;
  insert: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(async () => ({ id: LOG_ID }));
  const finish = vi.fn(async () => ({ ok: true as const }));

  const research = {
    diveSpawn: vi.fn(),
    diveStatus: vi.fn(),
    diveResults: vi.fn(),
    linksByThread: vi.fn(),
    inboxByThread: vi.fn(),
    inboxTriage: vi.fn(),
    interestRegister: vi.fn(),
    interestList: vi.fn(),
    interestDisable: vi.fn(),
    kbPromoteRequest: vi.fn(),
    toolCallLogInsert: insert,
    toolCallLogFinish: finish,
  } as unknown as HandlerContext["trpc"]["research"];

  const ctx: HandlerContext = {
    threadId: THREAD_ID,
    trpc: { research },
    ...overrides,
  };
  return { ctx, insert, finish };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("withLogging", () => {
  it("INSERTs on entry with threadId, runnerSessionId, toolName, args", async () => {
    const { ctx, insert, finish } = makeCtx({ runnerSessionId: RUNNER_ID });
    const inner: ToolHandler<"interest_list"> = async () => ({ items: [] });
    const wrapped = withLogging("interest_list", inner);

    await wrapped({}, ctx);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      threadId: THREAD_ID,
      runnerSessionId: RUNNER_ID,
      toolName: "interest_list",
      args: {},
    });
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("omits runnerSessionId from INSERT when the context has none", async () => {
    const { ctx, insert } = makeCtx();
    const inner: ToolHandler<"interest_list"> = async () => ({ items: [] });
    await withLogging("interest_list", inner)({}, ctx);

    const callArgs = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("runnerSessionId");
  });

  it("UPDATEs with finished_at + result_summary on success", async () => {
    const { ctx, finish } = makeCtx();
    const inner: ToolHandler<"interest_list"> = async () => ({
      items: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    await withLogging("interest_list", inner)({}, ctx);

    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith({
      id: LOG_ID,
      resultSummary: "items=3",
      error: null,
    });
  });

  it("UPDATEs with error on ToolHandlerError", async () => {
    const { ctx, finish } = makeCtx();
    const inner: ToolHandler<"interest_list"> = async () => {
      throw new ToolHandlerError("NOT_IMPLEMENTED", "stub", {
        retryable: false,
      });
    };
    const wrapped = withLogging("interest_list", inner);

    await expect(wrapped({}, ctx)).rejects.toBeInstanceOf(ToolHandlerError);

    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith({
      id: LOG_ID,
      resultSummary: null,
      error: "NOT_IMPLEMENTED: stub",
    });
  });

  it("UPDATEs with error on a generic Error", async () => {
    const { ctx, finish } = makeCtx();
    const inner: ToolHandler<"interest_list"> = async () => {
      throw new Error("kaboom");
    };
    const wrapped = withLogging("interest_list", inner);

    await expect(wrapped({}, ctx)).rejects.toThrow("kaboom");

    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith({
      id: LOG_ID,
      resultSummary: null,
      error: "kaboom",
    });
  });

  it("returns the handler result unchanged on success", async () => {
    const { ctx } = makeCtx();
    const payload = { items: [{ id: "x" }] };
    const inner: ToolHandler<"interest_list"> = async () => payload;
    const result = await withLogging("interest_list", inner)({}, ctx);
    expect(result).toBe(payload);
  });

  it("re-throws the original error after logging", async () => {
    const { ctx } = makeCtx();
    const err = new Error("original");
    const inner: ToolHandler<"interest_list"> = async () => {
      throw err;
    };
    await expect(withLogging("interest_list", inner)({}, ctx)).rejects.toBe(
      err,
    );
  });

  it("does not break the handler when INSERT fails", async () => {
    const { ctx, insert, finish } = makeCtx();
    insert.mockRejectedValueOnce(new Error("db down"));

    const inner: ToolHandler<"interest_list"> = async () => ({ items: [] });
    const result = await withLogging("interest_list", inner)({}, ctx);

    expect(result).toEqual({ items: [] });
    // No log id to finish against, so finish is never called.
    expect(finish).not.toHaveBeenCalled();
    // Failure was swallowed to console.error.
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not break the handler when the success UPDATE fails", async () => {
    const { ctx, finish } = makeCtx();
    finish.mockRejectedValueOnce(new Error("db blip"));

    const inner: ToolHandler<"interest_list"> = async () => ({ items: [] });
    const result = await withLogging("interest_list", inner)({}, ctx);

    expect(result).toEqual({ items: [] });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not shadow the original error when the error-path UPDATE fails", async () => {
    const { ctx, finish } = makeCtx();
    finish.mockRejectedValueOnce(new Error("log dead"));

    const originalError = new Error("handler failed");
    const inner: ToolHandler<"interest_list"> = async () => {
      throw originalError;
    };

    // The original handler error still propagates — the log failure is
    // swallowed to console.error.
    await expect(withLogging("interest_list", inner)({}, ctx)).rejects.toBe(
      originalError,
    );
    expect(errorSpy).toHaveBeenCalled();
  });
});
