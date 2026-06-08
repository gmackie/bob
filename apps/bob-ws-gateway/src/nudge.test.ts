import { describe, it, expect, vi } from "vitest";
import { createNudgeHandler, createWorkspaceEventHandler } from "./nudge.js";
import type { IncomingMessage, ServerResponse } from "node:http";

function mockReq(body: any, headers: Record<string, string> = {}): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  const req: any = {
    method: "POST",
    headers,
    on(event: string, cb: any) {
      if (event === "data") chunks.forEach((c) => cb(c));
      if (event === "end") cb();
      return req;
    },
  };
  return req;
}

function mockRes(): ServerResponse & { _status: number; _body: string } {
  const res: any = {
    _status: 0,
    _body: "",
    writeHead(status: number) {
      this._status = status;
      return this;
    },
    end(body?: string) {
      if (body) this._body = body;
      return this;
    },
    setHeader() {},
  };
  return res;
}

describe("nudge handler", () => {
  it("rejects missing authorization header", async () => {
    const nudge = vi.fn();
    const handler = createNudgeHandler({ sharedSecret: "s3cr3t", onNudge: nudge });
    const req = mockReq({ sessionId: "s", workspaceId: "w", workingDirectory: "/", agentType: "c" });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("rejects wrong shared secret", async () => {
    const nudge = vi.fn();
    const handler = createNudgeHandler({ sharedSecret: "s3cr3t", onNudge: nudge });
    const req = mockReq(
      { sessionId: "s", workspaceId: "w", workingDirectory: "/", agentType: "c" },
      { authorization: "Bearer wrong" },
    );
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("rejects missing required fields", async () => {
    const nudge = vi.fn();
    const handler = createNudgeHandler({ sharedSecret: "s3cr3t", onNudge: nudge });
    const req = mockReq({ sessionId: "s" }, { authorization: "Bearer s3cr3t" });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("calls onNudge with valid payload and returns 200", async () => {
    const nudge = vi.fn();
    const handler = createNudgeHandler({ sharedSecret: "s3cr3t", onNudge: nudge });
    const req = mockReq(
      {
        sessionId: "s1",
        workspaceId: "w1",
        workingDirectory: "/tmp",
        agentType: "claude",
        title: "test",
      },
      { authorization: "Bearer s3cr3t" },
    );
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(nudge).toHaveBeenCalledWith({
      sessionId: "s1",
      workspaceId: "w1",
      workingDirectory: "/tmp",
      agentType: "claude",
      title: "test",
    });
  });
});

describe("workspace event handler", () => {
  it("rejects missing authorization header", async () => {
    const notify = vi.fn();
    const handler = createWorkspaceEventHandler({ sharedSecret: "s3cr3t", onEvent: notify });
    const req = mockReq({ type: "queue_order_changed", workspaceId: "w1" });
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(401);
    expect(notify).not.toHaveBeenCalled();
  });

  it("calls onEvent with a valid workspace event payload", async () => {
    const notify = vi.fn();
    const handler = createWorkspaceEventHandler({ sharedSecret: "s3cr3t", onEvent: notify });
    const req = mockReq(
      {
        type: "queue_order_changed",
        workspaceId: "w1",
        entityId: "task-1",
        payload: { order: ["task-1", "task-2"] },
      },
      { authorization: "Bearer s3cr3t" },
    );
    const res = mockRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(notify).toHaveBeenCalledWith({
      type: "queue_order_changed",
      workspaceId: "w1",
      entityId: "task-1",
      payload: { order: ["task-1", "task-2"] },
    });
  });
});
