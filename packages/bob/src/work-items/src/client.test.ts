import { describe, expect, it, vi } from "vitest";

import * as workItemsModule from "./index";

const workspaceId = "11111111-1111-4111-8111-111111111111";

describe("createWorkItemsClient", () => {
  it("exposes the full work-item REST method surface", () => {
    const createWorkItemsClient = (workItemsModule as Record<string, unknown>)
      .createWorkItemsClient;

    expect(typeof createWorkItemsClient).toBe("function");

    if (typeof createWorkItemsClient !== "function") {
      return;
    }

    const client = createWorkItemsClient({
      baseUrl: "https://bob.example.com",
      fetch: vi.fn(),
    });

    expect(client).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      promoteToTask: expect.any(Function),
      listComments: expect.any(Function),
      createComment: expect.any(Function),
      createArtifact: expect.any(Function),
      listActivities: expect.any(Function),
      listCurrentArtifacts: expect.any(Function),
      listChildArtifactGroups: expect.any(Function),
      listNotifications: expect.any(Function),
      createNotification: expect.any(Function),
      markNotificationAsRead: expect.any(Function),
    });
  });

  it("posts JSON to the list endpoint and merges caller headers", async () => {
    const createWorkItemsClient = (workItemsModule as Record<string, unknown>)
      .createWorkItemsClient;

    expect(typeof createWorkItemsClient).toBe("function");

    if (typeof createWorkItemsClient !== "function") {
      return;
    }

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: "work-item-1", title: "Task 1", kind: "issue", status: "todo" },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const client = createWorkItemsClient({
      baseUrl: "https://bob.example.com/",
      fetch: fetchMock,
      getHeaders: async () => ({
        cookie: "better-auth.session_token=session-token",
        "x-bob-client": "mobile",
      }),
    });

    const result = await client.list({
      workspaceId,
      limit: 25,
    });

    expect(result).toEqual([
      { id: "work-item-1", title: "Task 1", kind: "issue", status: "todo" },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://bob.example.com/api/v1/work-items/list");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({
        workspaceId,
        limit: 25,
      }),
    );

    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("cookie")).toBe(
      "better-auth.session_token=session-token",
    );
    expect(headers.get("x-bob-client")).toBe("mobile");
  });

  it("throws a structured error for non-2xx responses", async () => {
    const createWorkItemsClient = (workItemsModule as Record<string, unknown>)
      .createWorkItemsClient;

    expect(typeof createWorkItemsClient).toBe("function");

    if (typeof createWorkItemsClient !== "function") {
      return;
    }

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_123",
        },
      }),
    );

    const client = createWorkItemsClient({
      baseUrl: "https://bob.example.com",
      fetch: fetchMock,
    });

    await expect(
      client.list({
        workspaceId,
      }),
    ).rejects.toMatchObject({
      name: "WorkItemsClientError",
      status: 401,
      path: "/api/v1/work-items/list",
      message: "Unauthorized",
      requestId: "req_123",
      body: { error: "Unauthorized" },
    });
  });
});
