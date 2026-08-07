import { describe, expect, it, vi } from "vitest";

import {
  OodaV1ClientError,
  createOodaV1Client,
} from "./client";

const conversation = {
  id: "conversation-1",
  ownerId: "user-1",
  title: "New thought",
  status: "active" as const,
  hostProvider: "grok",
  hostProfile: "daily",
  activeBranchId: "branch-1",
  lastSequence: "0",
  sensitivityCeiling: "personal" as const,
  ttsPolicy: "allowed" as const,
  createdAt: "2026-08-06T12:00:00.000Z",
  updatedAt: "2026-08-06T12:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OODA V1 client", () => {
  it("lists conversations with cursor parameters and current auth headers", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        items: [conversation],
        pageInfo: { nextCursor: "next-page", hasMore: true },
      }),
    );
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test/",
      fetch: fetchFn,
      headers: async () => ({ Cookie: "better-auth.session=secret" }),
    });

    const result = await client.conversations.list({
      cursor: "current-page",
      limit: 25,
      status: "active",
      query: "voice",
    });

    expect(result.items).toEqual([conversation]);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://ooda.example.test/api/v1/conversations?cursor=current-page&limit=25&status=active&query=voice",
    );
    expect(init).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({
        Accept: "application/json",
        Cookie: "better-auth.session=secret",
      }),
    });
  });

  it("appends an event without changing its device idempotency key", async () => {
    const event = {
      id: "event-1",
      conversationId: "conversation-1",
      branchId: "branch-1",
      sequence: "1",
      type: "user_turn" as const,
      actor: { type: "user" as const },
      payload: { display: "Capture this" },
      sensitivity: "personal" as const,
      correlationId: "correlation-1",
      idempotencyKey: "device-event-1",
      occurredAt: "2026-08-06T12:01:00.000Z",
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ event, replayed: false }));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });

    await client.events.append({
      conversationId: event.conversationId,
      branchId: event.branchId,
      type: event.type,
      actor: event.actor,
      payload: event.payload,
      sensitivity: event.sensitivity,
      correlationId: event.correlationId,
      idempotencyKey: event.idempotencyKey,
      occurredAt: event.occurredAt,
    });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://ooda.example.test/api/v1/events");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      idempotencyKey: "device-event-1",
      payload: { display: "Capture this" },
    });
  });

  it("throws one typed error for a versioned problem response", async () => {
    const problem = {
      version: "v1" as const,
      type: "https://ooda.example.test/problems/not-authenticated",
      title: "Authentication required",
      status: 401,
      code: "UNAUTHORIZED",
      detail: "Sign in again",
      correlationId: "correlation-problem",
    };
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(problem, 401)),
    });

    const error = await client.conversations
      .list()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OodaV1ClientError);
    expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED", problem });
  });

  it("builds a resumable authenticated stream request", async () => {
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test/",
      headers: () => ({ Authorization: "Bearer device-token" }),
    });

    const request = await client.events.streamRequest({
      conversationId: "conversation/id",
      afterSequence: "42",
    });

    expect(request.url).toBe(
      "https://ooda.example.test/api/v1/conversations/conversation%2Fid/events/stream?afterSequence=42",
    );
    expect(request.headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Bearer device-token",
      "Last-Event-ID": "42",
    });
  });

  it("creates an event-bound TTS grant and an authenticated audio source", async () => {
    const grant = {
      grantId: "grant-1",
      streamUrl: "https://ooda.example.test/api/v1/tts-streams/grant-1.signature",
      expiresAt: "2026-08-06T12:02:00.000Z",
      replayed: false,
    };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(grant, 201));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
      headers: () => ({ Authorization: "Bearer device-token" }),
    });

    await expect(client.voice.createGrant({
      conversationId: "conversation-1",
      eventId: "event-1",
      requestMode: "manual",
      idempotencyKey: "device-tts-1",
    })).resolves.toEqual(grant);
    await expect(client.voice.audioSource(grant.streamUrl)).resolves.toEqual({
      uri: grant.streamUrl,
      headers: {
        Accept: "audio/mpeg",
        Authorization: "Bearer device-token",
      },
    });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://ooda.example.test/api/v1/tts-grants");
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("text");
  });

  it("requests one host turn from a durable user event", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });

    await client.host.createTurn({
      conversationId: "conversation-1",
      userEventId: "event-user-1",
      idempotencyKey: "device-event-1:host",
    });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://ooda.example.test/api/v1/host-turns");
    expect(init).toMatchObject({ method: "POST" });
  });
});
