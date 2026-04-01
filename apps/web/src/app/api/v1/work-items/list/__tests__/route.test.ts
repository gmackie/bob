import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const createPublicApiCallerMock = vi.fn();
const errorResponseMock = vi.fn();

vi.mock("~/lib/rest/api-helpers", () => ({
  createPublicApiCaller: createPublicApiCallerMock,
  errorResponse: errorResponseMock,
}));

const { POST } = await import("../route");

describe("work item list REST route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createPublicApiCallerMock.mockResolvedValue({
      workItems: {
        list: listMock,
      },
    });

    errorResponseMock.mockImplementation(
      (error: unknown) =>
        new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : "unknown",
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        ),
    );
  });

  it("passes the JSON body through to caller.workItems.list", async () => {
    listMock.mockResolvedValueOnce([
      { id: "work-item-1", title: "Task 1", kind: "issue", status: "todo" },
    ]);

    const request = new Request("http://localhost/api/v1/work-items/list", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        limit: 25,
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(listMock).toHaveBeenCalledWith({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      limit: 25,
    });
    expect(body).toEqual([
      { id: "work-item-1", title: "Task 1", kind: "issue", status: "todo" },
    ]);
  });

  it("maps thrown errors through errorResponse", async () => {
    listMock.mockRejectedValueOnce(new Error("boom"));

    const request = new Request("http://localhost/api/v1/work-items/list", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "11111111-1111-4111-8111-111111111111",
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(errorResponseMock).toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "boom" });
  });
});
