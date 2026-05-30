import { afterEach, describe, expect, it, vi } from "vitest";

import { BobRunReporter } from "../bob-run-reporter";

const CFG = {
  baseUrl: "https://bob.example",
  apiKey: "bob_live_test",
  workspaceId: "ws-1",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BobRunReporter", () => {
  it("is disabled and no-ops when config is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as any);
    const r = new BobRunReporter({});
    expect(r.enabled).toBe(false);
    expect(await r.startRun({ workItemId: "w", agentType: "claude" })).toBeNull();
    await r.pushLog("anything", "output");
    await r.finishRun("anything", "completed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens a run (createRun + PATCH running) and returns the run id", async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    vi.spyOn(globalThis, "fetch" as any).mockImplementation((async (
      url: string,
      init: any,
    ) => {
      calls.push({ url, method: init.method, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: "run-123" }), { status: 200 });
    }) as any);

    const r = new BobRunReporter(CFG);
    const runId = await r.startRun({
      workItemId: "BOB-1",
      agentType: "codex",
      title: "Fix bug",
    });

    expect(runId).toBe("run-123");
    expect(calls[0]).toMatchObject({
      url: "https://bob.example/api/v1/runs",
      method: "POST",
      body: { workItemId: "BOB-1", workspaceId: "ws-1", agentType: "codex" },
    });
    expect(calls[0]!.body.agentConfig.title).toBe("Fix bug");
    expect(calls[1]).toMatchObject({
      url: "https://bob.example/api/v1/runs/run-123",
      method: "PATCH",
      body: { status: "running" },
    });
  });

  it("pushes log output inline as a log artifact", async () => {
    const calls: any[] = [];
    vi.spyOn(globalThis, "fetch" as any).mockImplementation((async (
      url: string,
      init: any,
    ) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response("{}", { status: 200 });
    }) as any);

    const r = new BobRunReporter(CFG);
    await r.pushLog("run-9", "hello stdout");

    expect(calls[0].url).toBe("https://bob.example/api/v1/runs/run-9/artifacts");
    expect(calls[0].body).toMatchObject({ type: "log" });
    expect(calls[0].body.metadata.content).toBe("hello stdout");
  });

  it("never throws when the network fails", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockRejectedValue(new Error("ECONNREFUSED"));
    const r = new BobRunReporter(CFG);
    await expect(r.startRun({ workItemId: "w", agentType: "x" })).resolves.toBeNull();
    await expect(r.pushLog("run-1", "x")).resolves.toBeUndefined();
    await expect(r.finishRun("run-1", "failed")).resolves.toBeUndefined();
  });

  it("does not call finish when there is no run id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as any);
    const r = new BobRunReporter(CFG);
    await r.finishRun(null, "completed");
    await r.pushLog(null, "x");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
