import { describe, expect, it, vi } from "vitest";

import {
  HANDLERS,
  TOOLS,
  TOOL_NAMES,
  type BudgetState,
  type HandlerContext,
  type ToolName,
} from "@gmacko/ooda/buddy-tools";

import {
  createBuddyToolDescriptors,
  registerTools,
  type ToolDescriptor,
} from "../tool-registry";
import type { AgentAdapter, AdapterCommand, AdapterEvent } from "../types";

function buildBudget(): BudgetState {
  return { tokens: 1_000_000, wallClockMs: 60_000, s2Requests: 200 };
}

function buildCtx(): HandlerContext {
  // The descriptors we produce only invoke `trpc.research.*` for tools
  // that actually have backing procedures. Tests either assert on
  // closure wiring (not dispatch) or stub out the few procedures they
  // exercise explicitly.
  const trpcStubs = Object.fromEntries(
    [
      "diveSpawn",
      "diveStatus",
      "diveResults",
      "linksByThread",
      "inboxByThread",
      "inboxTriage",
      "interestRegister",
      "interestList",
      "interestDisable",
      "kbPromoteRequest",
      "toolCallLogInsert",
      "toolCallLogFinish",
    ].map((name) => [name, vi.fn().mockResolvedValue({})]),
  );

  return {
    threadId: "11111111-1111-1111-1111-111111111111",
    runnerSessionId: "runner-test",
    trpc: {
      research: trpcStubs as unknown as HandlerContext["trpc"]["research"],
    },
  };
}

describe("createBuddyToolDescriptors", () => {
  it("produces one descriptor per ToolName", () => {
    const descriptors = createBuddyToolDescriptors(buildCtx(), {
      budget: buildBudget(),
    });

    expect(descriptors).toHaveLength(TOOL_NAMES.length);
    const names = descriptors.map((d) => d.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it("copies description and argsSchema from TOOLS[name]", () => {
    const descriptors = createBuddyToolDescriptors(buildCtx(), {
      budget: buildBudget(),
    });

    for (const d of descriptors) {
      const tool = TOOLS[d.name];
      expect(d.description).toBe(tool.description);
      expect(d.argsSchema).toBe(tool.args);
    }
  });

  it("closes over HandlerContext so handler accepts args only", async () => {
    const ctx = buildCtx();
    const descriptors = createBuddyToolDescriptors(ctx, {
      budget: buildBudget(),
      logging: false,
    });

    // `cp_open_url` is a pure handler — doesn't need tRPC — so it
    // exercises the closure wiring without needing procedure mocks.
    const cp = descriptors.find((d) => d.name === "cp_open_url");
    expect(cp).toBeDefined();

    const handlerArity = cp!.handler.length;
    // ToolHandler signature is (args, ctx) — but the descriptor's
    // closure binds ctx, so `handler.length` should be 1 (args only).
    expect(handlerArity).toBe(1);
  });

  it("applies budget middleware (short-circuits when exhausted)", async () => {
    const budget: BudgetState = {
      tokens: 0,
      wallClockMs: 60_000,
      s2Requests: 200,
    };
    const descriptors = createBuddyToolDescriptors(buildCtx(), {
      budget,
      logging: false,
    });

    const cp = descriptors.find((d) => d.name === "cp_open_url")!;
    // Budget exhausted at tokens=0; middleware throws BUDGET_EXHAUSTED
    // before the handler runs.
    await expect(
      // Second arg ignored — closure supplies ctx.
      cp.handler({ source_ids: [1] }, undefined as unknown as HandlerContext),
    ).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
  });

  it("wires each descriptor.handler through HANDLERS[name]", async () => {
    // The wrapped descriptor handler should reach the raw entry in
    // `HANDLERS`. `dive_spawn` is backed by a real tRPC procedure
    // (`research.diveSpawn`), and the ctx built above stubs that call
    // to `{}` — so invoking the descriptor's handler should resolve
    // without throwing, proving the closure is wired through the
    // middleware stack and into the registry.
    const ctx = buildCtx();
    const descriptors = createBuddyToolDescriptors(ctx, {
      budget: buildBudget(),
      logging: false,
    });

    const diveSpawn = descriptors.find((d) => d.name === "dive_spawn")!;
    await expect(
      diveSpawn.handler(
        {
          seeds: ["10.1234/example"],
          depth: 2,
          budget_papers: 60,
          budget_seconds: 180,
          focus: "balanced",
        },
        undefined as unknown as HandlerContext,
      ),
    ).resolves.toBeDefined();
    expect(HANDLERS.dive_spawn).toBeDefined();
  });
});

describe("registerTools", () => {
  function makeAdapter(
    registerFn?: (tools: { name: string; description: string }[]) => void,
  ): AgentAdapter {
    return {
      id: "fake",
      name: "Fake Adapter",
      transport: "stdio",
      isAvailable: () => true,
      buildCommand: () =>
        ({ binary: "fake", args: [], cwd: "/tmp" }) as AdapterCommand,
      execute: async (_cmd, _onEvent: (e: AdapterEvent) => void) => ({
        exitCode: 0,
      }),
      ...(registerFn ? { registerTools: registerFn } : {}),
    };
  }

  it("no-ops when adapter does not implement registerTools", () => {
    const adapter = makeAdapter();
    const tools: ToolDescriptor[] = createBuddyToolDescriptors(buildCtx(), {
      budget: buildBudget(),
      logging: false,
    });

    expect(() => registerTools(adapter, tools)).not.toThrow();
  });

  it("forwards descriptors when adapter implements registerTools", () => {
    const spy = vi.fn();
    const adapter = makeAdapter(spy);
    const tools: ToolDescriptor[] = createBuddyToolDescriptors(buildCtx(), {
      budget: buildBudget(),
      logging: false,
    });

    registerTools(adapter, tools);

    expect(spy).toHaveBeenCalledTimes(1);
    const forwarded = spy.mock.calls[0]![0] as ToolDescriptor[];
    expect(forwarded).toHaveLength(TOOL_NAMES.length);
    expect(forwarded.map((t) => t.name).sort()).toEqual(
      [...TOOL_NAMES].sort() as ToolName[],
    );
  });
});
