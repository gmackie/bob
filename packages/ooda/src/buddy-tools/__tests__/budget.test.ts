import { describe, expect, it, vi } from "vitest";

import { ToolHandlerError } from "../handler";
import type { HandlerContext, ToolHandler } from "../handler";
import { withBudget } from "../middleware/budget";
import type { BudgetState } from "../middleware/budget";

const THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeCtx(): HandlerContext {
  // The budget middleware never touches tRPC, but HandlerContext requires it.
  // A Proxy that throws on any access makes the "did not call tRPC" contract
  // observable: if the middleware ever tries to, the test fails loudly.
  const trpc = new Proxy(
    {},
    {
      get() {
        throw new Error("withBudget must not access tRPC");
      },
    },
  ) as HandlerContext["trpc"];
  return { threadId: THREAD_ID, trpc };
}

function freshBudget(partial: Partial<BudgetState> = {}): BudgetState {
  return {
    tokens: 1000,
    wallClockMs: 10_000,
    s2Requests: 200,
    ...partial,
  };
}

describe("withBudget", () => {
  it("invokes the handler when every bucket has headroom", async () => {
    const budget = freshBudget();
    const inner = vi.fn(async () => ({ ok: "yes" }));
    const wrapped = withBudget(inner as ToolHandler<"interest_list">, budget);

    const result = await wrapped({}, makeCtx());
    expect(result).toEqual({ ok: "yes" });
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("throws BUDGET_EXHAUSTED when tokens are depleted", async () => {
    const budget = freshBudget({ tokens: 0 });
    const inner = vi.fn();
    const wrapped = withBudget(inner as ToolHandler<"interest_list">, budget);

    await expect(wrapped({}, makeCtx())).rejects.toMatchObject({
      code: "BUDGET_EXHAUSTED",
      retryable: false,
    });
    // Handler must not have been called.
    expect(inner).not.toHaveBeenCalled();
  });

  it("throws BUDGET_EXHAUSTED when wall-clock is depleted", async () => {
    const budget = freshBudget({ wallClockMs: 0 });
    const inner = vi.fn();
    const wrapped = withBudget(inner as ToolHandler<"interest_list">, budget);

    await expect(wrapped({}, makeCtx())).rejects.toBeInstanceOf(
      ToolHandlerError,
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("throws BUDGET_EXHAUSTED when s2Requests are depleted", async () => {
    const budget = freshBudget({ s2Requests: 0 });
    const inner = vi.fn();
    const wrapped = withBudget(inner as ToolHandler<"interest_list">, budget);

    await expect(wrapped({}, makeCtx())).rejects.toMatchObject({
      code: "BUDGET_EXHAUSTED",
    });
    expect(inner).not.toHaveBeenCalled();
  });

  it("deducts elapsed ms from wallClockMs after a successful call", async () => {
    const budget = freshBudget({ wallClockMs: 500 });
    const inner: ToolHandler<"interest_list"> = async () => {
      // Simulate ~50ms of work. Wall-clock shrinkage is measured via
      // Date.now() deltas, which are not mocked here — we just assert
      // the bucket strictly decreased.
      await new Promise((r) => setTimeout(r, 20));
      return { items: [] };
    };
    const wrapped = withBudget(inner, budget);

    await wrapped({}, makeCtx());
    expect(budget.wallClockMs).toBeLessThan(500);
    // Sanity: we didn't over-deduct into a wildly negative number.
    expect(budget.wallClockMs).toBeGreaterThan(-1000);
  });

  it("shares budget state across multiple wrapped handlers", async () => {
    const budget = freshBudget({ tokens: 100 });
    const handlerA: ToolHandler<"interest_list"> = async () => ({ a: 1 });
    const handlerB: ToolHandler<"interest_list"> = async () => ({ b: 2 });
    const wrappedA = withBudget(handlerA, budget, { tokens: 40 });
    const wrappedB = withBudget(handlerB, budget, { tokens: 40 });

    await wrappedA({}, makeCtx());
    await wrappedB({}, makeCtx());
    expect(budget.tokens).toBe(20);

    // A third call with tokens=40 should still run (20 > 0 at pre-check),
    // then the bucket drops negative and subsequent calls short-circuit.
    const wrappedC = withBudget(handlerA, budget, { tokens: 40 });
    await wrappedC({}, makeCtx());
    expect(budget.tokens).toBeLessThanOrEqual(0);

    const wrappedD = withBudget(handlerB, budget, { tokens: 1 });
    await expect(wrappedD({}, makeCtx())).rejects.toMatchObject({
      code: "BUDGET_EXHAUSTED",
    });
  });

  it("deducts s2Requests when a cost hint is supplied (passthrough)", async () => {
    const budget = freshBudget({ s2Requests: 10 });
    const inner: ToolHandler<"interest_list"> = async () => ({ items: [] });
    const wrapped = withBudget(inner, budget, { s2Requests: 3 });

    await wrapped({}, makeCtx());
    expect(budget.s2Requests).toBe(7);
  });

  it("deducts wall-clock even when the handler throws", async () => {
    const budget = freshBudget({ wallClockMs: 500 });
    const inner: ToolHandler<"interest_list"> = async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("boom");
    };
    const wrapped = withBudget(inner, budget);

    await expect(wrapped({}, makeCtx())).rejects.toThrow("boom");
    expect(budget.wallClockMs).toBeLessThan(500);
  });
});
