import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { InternalPrincipal } from "./auth.js";
import { createBudgetUsageHandler } from "./budget-http.js";

function request(body: unknown, headers: Record<string, string> = { authorization: "Bearer owner-key" }): IncomingMessage {
  const chunks = [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = {
    method: "POST",
    headers,
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === "data") chunks.forEach((chunk) => cb(chunk));
      if (event === "end") cb();
      return req;
    },
  };
  return req as unknown as IncomingMessage;
}

function response() {
  const res = {
    status: 0,
    body: "",
    writeHead(status: number) {
      res.status = status;
      return res;
    },
    end(body?: string) {
      if (body) res.body = body;
      return res;
    },
  };
  return res;
}

const principals: Record<string, InternalPrincipal> = {
  "owner-key": { kind: "apiKey", userId: "owner" },
  "other-key": { kind: "apiKey", userId: "someone-else" },
  legacy: { kind: "legacy" },
};

function handler(ingest = vi.fn(async () => {})) {
  const onAudit = vi.fn();
  const handle = createBudgetUsageHandler({
    authorize: async (bearer) => principals[bearer] ?? null,
    resolveWorkspaceOwner: async (workspaceId) => (workspaceId === "ws-1" ? "owner" : null),
    onAudit,
    ingest,
  });
  return { handle, ingest, onAudit };
}

const BODY = { type: "budget_usage", workspaceId: "ws-1", hostId: "labnuc", buckets: [{ hour: "2026-11-15T10:00:00.000Z" }], sessions: [], links: [] };

describe("POST /internal/budget-usage", () => {
  it("stores the usage under the posted workspace and host for the workspace owner's key", async () => {
    const { handle, ingest } = handler();
    const res = response();
    await handle(request(BODY), res as unknown as ServerResponse);
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith({ workspaceId: "ws-1", hostId: "labnuc" }, expect.objectContaining({ buckets: BODY.buckets }));
  });

  it.each([
    ["no bearer", {}],
    ["an unknown key", { authorization: "Bearer nope" }],
    ["the legacy shared secret", { authorization: "Bearer legacy" }],
  ])("refuses %s", async (_label, headers) => {
    const { handle, ingest } = handler();
    const res = response();
    await handle(request(BODY, headers), res as unknown as ServerResponse);
    expect(res.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("refuses a key that does not own the workspace and audits it", async () => {
    const { handle, ingest, onAudit } = handler();
    const res = response();
    await handle(request(BODY, { authorization: "Bearer other-key" }), res as unknown as ServerResponse);
    expect(res.status).toBe(403);
    expect(ingest).not.toHaveBeenCalled();
    expect(onAudit).toHaveBeenCalledWith(principals["other-key"], "internal.denied", expect.objectContaining({ endpoint: "budget-usage" }));
  });

  it.each([
    ["a missing host", { ...BODY, hostId: undefined }],
    ["a host with a slash", { ...BODY, hostId: "../etc" }],
    ["a missing workspace", { ...BODY, workspaceId: undefined }],
    ["a non-object body", [1, 2]],
  ])("rejects %s", async (_label, body) => {
    const { handle, ingest } = handler();
    const res = response();
    await handle(request(body), res as unknown as ServerResponse);
    expect(res.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("answers 500 when storing fails so the collector retries", async () => {
    const { handle } = handler(vi.fn(async () => {
      throw new Error("db down");
    }));
    const res = response();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await handle(request(BODY), res as unknown as ServerResponse);
    expect(res.status).toBe(500);
  });
});
