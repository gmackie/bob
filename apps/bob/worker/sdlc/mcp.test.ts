import { describe, expect, it, vi } from "vitest";
import {
  DEMO_THREADS,
  demoCi,
  demoItems,
  demoPlan,
  demoTail,
} from "../../src/server/mcp/views/sdlc-fixtures";
import { mcpSdlcResponse } from "./mcp";
import { EdgeController } from "./controller";
import { nodeSqlitePort } from "./test-helpers/node-sqlite";

describe("MCP queries of the workspace SDLC Durable Object", () => {
  it("recovers fleet and thread state after reconstruction and reads live evidence only for the matching item", async () => {
    const sql = nodeSqlitePort();
    const options = { sql, sockets: () => [] };
    new EdgeController(options).ingest({
      contractVersion: "1",
      kind: "snapshot",
      watermark: 1,
      plans: [demoPlan],
      items: demoItems,
    });
    const { store } = new EdgeController(options);
    const attempts = {
      detail: vi.fn(async () => ({
        tail: demoTail("item-a")?.frame,
        tailUnavailable: undefined,
        ci: demoCi("item-a"),
      })),
    };
    const read = async (params = "") =>
      (await mcpSdlcResponse(new URL("https://sdlc-edge/mcp" + params), store, attempts)).json();
    expect(await read()).toMatchObject({
      scope: "fleet",
      totalItems: 4,
      offline: false,
      refreshSeconds: 15,
    });
    expect(await read(`?threadId=${DEMO_THREADS.waiting}&raw=true`)).toMatchObject({
      threadId: DEMO_THREADS.waiting,
      item: { itemId: "item-b" },
      plan: { planId: demoPlan.planId },
    });
    expect(await read("?threadId=unknown&raw=true")).toMatchObject({ item: null, plan: null });
    expect(await read("?threadId=unknown")).toMatchObject({ scope: "thread", item: null });
    expect(attempts.detail).not.toHaveBeenCalled();
    expect(await read(`?threadId=${DEMO_THREADS.running}`)).toMatchObject({
      scope: "thread",
      refreshSeconds: 5,
      item: { itemId: "item-a", tail: { lines: expect.any(Array) }, ci: { available: true } },
    });
    expect(attempts.detail).toHaveBeenCalledOnce();
  });
});
