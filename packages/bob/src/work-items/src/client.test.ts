import { describe, expect, it, vi } from "vitest";

import { createWorkItemsClient } from "./index";

const workspaceId = "11111111-1111-4111-8111-111111111111";

describe("createWorkItemsClient", () => {
  it("exposes the full work-item REST method surface", () => {
    const client = createWorkItemsClient({
      baseUrl: "https://bob.example.com",
      fetch: vi.fn(),
    });

    // `expect.any(Function)` in a `toMatchObject` literal type-checks each
    // property against `WorkItemsClient`'s real method signatures, but
    // vitest's `expect.any()` helper is declared to return `any` (needed so
    // it can partial-match arbitrary shapes) — every property assignment
    // below would trip no-unsafe-assignment even though this is the
    // standard, correct vitest idiom for "assert this is a function".
    // Assert each method's typeof individually instead, which stays fully
    // typed end to end.
    const methodNames = [
      "list",
      "get",
      "promoteToTask",
      "listComments",
      "createComment",
      "createArtifact",
      "listActivities",
      "listCurrentArtifacts",
      "listChildArtifactGroups",
      "listNotifications",
      "createNotification",
      "markNotificationAsRead",
    ] as const;

    for (const methodName of methodNames) {
      expect(typeof client[methodName]).toBe("function");
    }
  });

  it("posts JSON to the list endpoint and merges caller headers", async () => {
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
      getHeaders: () => ({
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
        limit: 25,
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
