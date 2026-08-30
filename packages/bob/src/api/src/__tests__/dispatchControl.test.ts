import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchControlSet } from "../handlers/dispatchControl";

const OWNER = "user-owner";
const WORKSPACE = "11111111-1111-1111-1111-111111111111";

function ctx(ownerUserId: string | null) {
  return {
    db: {
      query: {
        workspaces: {
          findFirst: () =>
            Promise.resolve(ownerUserId ? { id: WORKSPACE, ownerUserId } : undefined),
        },
      },
    },
    userId: OWNER,
  } as never;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.GATEWAY_URL = "https://gw.test";
  process.env.NUDGE_SHARED_SECRET = "shhh";
  fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }))));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GATEWAY_URL;
  delete process.env.NUDGE_SHARED_SECRET;
});

describe("dispatchControlSet", () => {
  it("relays a start to the gateway for the workspace owner", async () => {
    await expect(
      dispatchControlSet(ctx(OWNER), { workspaceId: WORKSPACE, action: "start", requestId: "r1" }),
    ).resolves.toMatchObject({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://gw.test/internal/dispatch-control");
    expect(JSON.parse(init.body)).toMatchObject({
      workspaceId: WORKSPACE,
      action: "start",
      requestId: "r1",
    });
  });

  it("refuses a non-owner", async () => {
    // Starting the runner spends the owner's agent credits. A member of the
    // workspace must not be able to turn that on.
    await expect(
      dispatchControlSet(ctx("someone-else"), {
        workspaceId: WORKSPACE,
        action: "start",
        requestId: "r2",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an offline host as a precondition failure, not a server error", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));

    await expect(
      dispatchControlSet(ctx(OWNER), { workspaceId: WORKSPACE, action: "stop", requestId: "r3" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("fails closed when the gateway is not configured", async () => {
    delete process.env.GATEWAY_URL;

    await expect(
      dispatchControlSet(ctx(OWNER), { workspaceId: WORKSPACE, action: "start", requestId: "r4" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
