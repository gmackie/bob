import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as forgeApi from "@linear-clone/api";
import {
  GET,
  POST,
  setFunnelWebhookDb,
} from "@/app/api/webhooks/funnel/route";
import { createFakeDatabase } from "./forge/fake-db";

vi.mock("@linear-clone/api", async () => {
  const actual = await vi.importActual<typeof import("@linear-clone/api")>("@linear-clone/api");

  return {
    ...actual,
    buildIssuePayload: vi.fn((issue: unknown) => issue),
    dispatchWebhook: vi.fn(() => Promise.resolve()),
  };
});

afterEach(() => {
  process.env.FUNNEL_WEBHOOK_TOKEN = "";
  process.env.FORGEGRAPH_FUNNEL_WEBHOOK_TOKEN = "";
  setFunnelWebhookDb(null);
  vi.clearAllMocks();
});

describe("funnel webhook status endpoint", () => {
  it("returns health check response", async () => {
    const response = await GET();

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toEqual({ status: "ok", source: "funnel" });
  });
});

describe("funnel issue POST endpoint", () => {
  it("authorizes request when token is missing but no server token configured", async () => {
    process.env.FUNNEL_WEBHOOK_TOKEN = "";
    process.env.FORGEGRAPH_FUNNEL_WEBHOOK_TOKEN = "";

    const response = await POST(
      new NextRequest("https://linear-clone.local/api/webhooks/funnel", {
        method: "POST",
        headers: {
          authorization: "Bearer anything",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: "12345678-1234-4123-8123-123456789abc",
          title: "Fallback title",
        }),
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("supports x-webhook-token header and enforces epic restrictions", async () => {
    process.env.FUNNEL_WEBHOOK_TOKEN = "expected-token";

    const response = await POST(
      new NextRequest("https://linear-clone.local/api/webhooks/funnel", {
        method: "POST",
        headers: {
          "x-webhook-token": "expected-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: "12345678-1234-4123-8123-123456789abc",
          type: "epic",
          title: "Epic in funnel",
          teamId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Epics cannot have a team or assignee in funnel ingestion",
    });
  });

  it("returns invalid parent issue response for bad parentIssueId", async () => {
    process.env.FORGEGRAPH_FUNNEL_WEBHOOK_TOKEN = "expected-token";

    const { db } = createFakeDatabase({
      selectResponses: [
        [{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", key: "IDEA", workspaceId: "11111111-1111-4111-8111-111111111111", issueCount: 1 }],
        [],
      ],
    });
    setFunnelWebhookDb(db as never);

    const response = await POST(
      new NextRequest("https://linear-clone.local/api/webhooks/funnel", {
        method: "POST",
        headers: {
          "x-funnel-token": "expected-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          title: "Nested task",
          parentIssueId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid parentIssueId" });
  });

  it("falls back to workspace owner when creator is omitted", async () => {
    process.env.FUNNEL_WEBHOOK_TOKEN = "expected-token";

    const { db, insertValues, calls } = createFakeDatabase({
      selectResponses: [
        [{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", key: "IDEA", workspaceId: "11111111-1111-4111-8111-111111111111", issueCount: 11 }],
        [{ ownerId: "cccccccc-cccc-4ccc-cccc-cccccccccccc" }],
        [],
      ],
      updateResponses: [
        [{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", issueCount: 12, key: "IDEA", workspaceId: "11111111-1111-4111-8111-111111111111" }],
      ],
    });
    setFunnelWebhookDb(db as never);

    const response = await POST(
      new NextRequest("https://linear-clone.local/api/webhooks/funnel", {
        method: "POST",
        headers: {
          "x-webhook-token": "expected-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          title: "Fallback owner",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "created",
      identifier: "IDEA-12",
    });
    expect(calls.select).toBe(3);
    expect(calls.insert).toBe(3);

    const insertedIssue = insertValues[0] as {
      creatorId?: string;
      title?: string;
    };
    expect(insertedIssue.creatorId).toBe("cccccccc-cccc-4ccc-cccc-cccccccccccc");
    expect(insertedIssue.title).toBe("Fallback owner");
  });

  it("returns unauthorized when token mismatch", async () => {
    process.env.FUNNEL_WEBHOOK_TOKEN = "expected-token";

    const response = await POST(
      new NextRequest("https://linear-clone.local/api/webhooks/funnel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "12345678-1234-4123-8123-123456789abc", title: "Fallback title" }),
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("uses FORGEGRAPH_FUNNEL_WEBHOOK_TOKEN and returns invalid payload for bad input", async () => {
    process.env.FORGEGRAPH_FUNNEL_WEBHOOK_TOKEN = "alias-token";

    const response = await POST(
      new NextRequest("https://linear-clone.local/api/webhooks/funnel", {
        method: "POST",
        headers: {
          authorization: "Bearer alias-token",
          "content-type": "application/json",
        },
        body: "not json",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid payload" });
  });

  it("returns 404 when projectId does not exist", async () => {
    process.env.FUNNEL_WEBHOOK_TOKEN = "expected-token";
    const { db } = createFakeDatabase({
      selectResponses: [[]],
    });
    setFunnelWebhookDb(db as never);

    const response = await POST(
      new NextRequest("https://linear-clone.local/api/webhooks/funnel", {
        method: "POST",
        headers: {
          authorization: "Bearer expected-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          title: "Missing project",
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Project not found" });
  });

  it("creates an issue with fallback title and resolves creator by email", async () => {
    process.env.FUNNEL_WEBHOOK_TOKEN = "expected-token";
    const { db, insertValues, calls } = createFakeDatabase({
      selectResponses: [
        [{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", key: "IDEA", workspaceId: "11111111-1111-4111-8111-111111111111", issueCount: 11 }],
        [{ ownerId: "cccccccc-cccc-4ccc-cccc-cccccccccccc" }],
        [{ id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" }],
        [],
      ],
      updateResponses: [
        [{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", issueCount: 12, key: "IDEA", workspaceId: "11111111-1111-4111-8111-111111111111" }],
      ],
    });
    setFunnelWebhookDb(db as never);

    const response = await POST(
      new NextRequest("https://linear-clone.local/api/webhooks/funnel", {
        method: "POST",
        headers: {
          "x-funnel-token": "expected-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          description: "A quick one-line idea",
          creatorEmail: "owner@example.com",
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "created",
      funnelStage: "dumped",
      identifier: "IDEA-12",
    });
    expect(calls.select).toBe(4);
    expect(calls.update).toBe(1);
    expect(calls.insert).toBe(3);

    const insertedIssue = insertValues[0] as {
      title?: string;
      creatorId?: string;
      projectId?: string;
      identifier?: string;
      funnelSourceType?: string;
    };
    expect(insertedIssue.title).toBe("A quick one-line idea");
    expect(insertedIssue.creatorId).toBe("bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb");
    expect(insertedIssue.projectId).toBe("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
    expect(insertedIssue.identifier).toBe("IDEA-12");
    expect(insertedIssue.funnelSourceType).toBe("api");

    const dispatchSpy = vi.mocked(forgeApi.dispatchWebhook);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const dispatchCall = dispatchSpy.mock.calls[0];
    expect(dispatchCall[1]).toBe("11111111-1111-4111-8111-111111111111");
    expect(dispatchCall[2]).toBe("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
    expect(dispatchCall[3]).toBe("issue.created");
    expect((dispatchCall[4] as { id?: string }).id).toBe((insertedIssue as { id?: string }).id ?? "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
  });
});
