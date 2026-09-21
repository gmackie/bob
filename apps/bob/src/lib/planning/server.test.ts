import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  headers: vi.fn(),
  handler: vi.fn(),
}));
vi.mock("~/auth/server", () => ({ getSession: mocks.session }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect:/login");
  },
}));
vi.mock("~/server/rpc", () => ({ rpcHandler: mocks.handler }));
import { createPlanningClient } from "./server";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user" } });
  mocks.headers.mockResolvedValue(
    new Headers({
      cookie: "session=verified-by-rpc",
      authorization: "Bearer caller-token",
      "x-tenant-id": "tenant",
      host: "attacker.example",
      "x-forwarded-host": "attacker.example",
      "x-private-secret": "do-not-forward",
    }),
  );
});
describe("server Effect client", () => {
  it("routes contract requests in process with only authentication headers", async () => {
    mocks.handler.mockImplementation(async (request: Request) => {
      const messages = (await request.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const call = messages.find((message) => message._tag === "Request");
      expect(call.tag).toBe("workItem.list");
      return new Response(
        JSON.stringify({
          _tag: "Exit",
          requestId: call.id,
          exit: { _tag: "Success", value: [] },
        }) + "\n",
        { headers: { "content-type": "application/ndjson" } },
      );
    });
    const client = await createPlanningClient();
    expect(
      await client("workItem.list").call({ workspaceId: "workspace" }),
    ).toEqual([]);
    const request = mocks.handler.mock.calls[0]![0] as Request;
    expect(new URL(request.url).origin).toBe("http://bob.internal");
    expect(request.headers.get("cookie")).toBe("session=verified-by-rpc");
    expect(request.headers.get("authorization")).toBe("Bearer caller-token");
    expect(request.headers.get("x-tenant-id")).toBe("tenant");
    expect(request.headers.has("x-forwarded-host")).toBe(false);
    expect(request.headers.has("x-private-secret")).toBe(false);
  });
  it("redirects unauthenticated renders before dispatching", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(createPlanningClient()).rejects.toThrow("redirect:/login");
    expect(mocks.handler).not.toHaveBeenCalled();
  });
  it("does not turn an RPC authentication failure into successful data", async () => {
    mocks.handler.mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    const client = await createPlanningClient();
    await expect(
      client("workItem.list").call({ workspaceId: "workspace" }),
    ).rejects.toThrow();
  });
});
