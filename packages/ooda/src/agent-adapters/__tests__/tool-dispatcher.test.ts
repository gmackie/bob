import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ToolHandlerError, type ToolHandler, type ToolName } from "@gmacko/ooda/buddy-tools";

import { dispatchBuddyTool } from "../tool-dispatcher";
import { handleAgentRequest } from "../grok-acp";
import type { ToolDescriptor } from "../tool-registry";

/**
 * Build a single descriptor with a controllable handler. `name` is a real
 * ToolName so the descriptor type is honest; the schema + handler are
 * bespoke so each test drives one dispatch path in isolation.
 */
function makeDescriptor(
  overrides: Partial<ToolDescriptor> & { handler: (args: unknown) => Promise<unknown> },
): ToolDescriptor {
  return {
    name: "papers_search" satisfies ToolName,
    description: "test tool",
    argsSchema: z.object({ query: z.string() }),
    ...overrides,
    // The dispatcher invokes the bound (args-only) handler; the ToolHandler
    // type keeps the (args, ctx) shape for parity with the real registry.
    handler: overrides.handler as unknown as ToolHandler<ToolName>,
  };
}

describe("dispatchBuddyTool", () => {
  it("returns an UNKNOWN_TOOL error for a name with no descriptor", async () => {
    const handler = vi.fn(async () => ({ ok: 1 }));
    const descriptors = [makeDescriptor({ handler })];

    const result = await dispatchBuddyTool(descriptors, "does_not_exist", {});

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNKNOWN_TOOL");
    expect(handler).not.toHaveBeenCalled();
  });

  it("validates args and invokes the handler on a valid call", async () => {
    const handler = vi.fn(async (args: unknown) => ({ echoed: args }));
    const descriptors = [makeDescriptor({ handler })];

    const result = await dispatchBuddyTool(descriptors, "papers_search", {
      query: "sleep",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ query: "sleep" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ echoed: { query: "sleep" } });
  });

  it("returns an INVALID_ARGS error (and skips the handler) on schema failure", async () => {
    const handler = vi.fn(async () => ({ ok: 1 }));
    const descriptors = [makeDescriptor({ handler })];

    // `query` is required to be a string — a number fails validation.
    const result = await dispatchBuddyTool(descriptors, "papers_search", {
      query: 42,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_ARGS");
    expect(result.error?.message).toContain("query");
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes a ToolHandlerError through with its code + retry semantics", async () => {
    const handler = vi.fn(async () => {
      throw new ToolHandlerError("BUDGET_EXHAUSTED", "no budget left", {
        retryable: false,
      });
    });
    const descriptors = [makeDescriptor({ handler })];

    const result = await dispatchBuddyTool(descriptors, "papers_search", {
      query: "x",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUDGET_EXHAUSTED");
    expect(result.error?.retryable).toBe(false);
  });

  it("wraps an unexpected handler throw in a HANDLER_ERROR result (never rejects)", async () => {
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    const descriptors = [makeDescriptor({ handler })];

    const result = await dispatchBuddyTool(descriptors, "papers_search", {
      query: "x",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("HANDLER_ERROR");
    expect(result.error?.message).toBe("boom");
  });
});

describe("handleAgentRequest tools/call bridge", () => {
  it("routes a tools/call request through the dispatcher into an MCP result", async () => {
    const handler = vi.fn(async (args: unknown) => ({ echoed: args }));
    const descriptors = [makeDescriptor({ handler })];

    const out = (await handleAgentRequest(
      "/tmp/ws",
      "tools/call",
      { name: "papers_search", arguments: { query: "sleep" } },
      descriptors,
    )) as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(handler).toHaveBeenCalledWith({ query: "sleep" });
    expect(out.isError).toBe(false);
    const payload = JSON.parse(out.content[0]!.text) as {
      ok: boolean;
      data: unknown;
    };
    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual({ echoed: { query: "sleep" } });
  });

  it("marks isError when the dispatched tool is unknown", async () => {
    const out = (await handleAgentRequest(
      "/tmp/ws",
      "tools/call",
      { name: "nope", arguments: {} },
      [],
    )) as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(out.isError).toBe(true);
    const payload = JSON.parse(out.content[0]!.text) as {
      ok: boolean;
      error: { code: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("UNKNOWN_TOOL");
  });

  it("still returns null for unrelated unhandled methods", () => {
    expect(handleAgentRequest("/tmp/ws", "unknown/method", {})).toBeNull();
  });
});
