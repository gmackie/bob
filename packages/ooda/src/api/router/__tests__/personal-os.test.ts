import { afterAll, describe, expect, it, vi } from "vitest";

import type { AuthInstance } from "@gmacko/core/auth";

const DATABASE_URL_PLACEHOLDER = "postgres://localhost/ooda-personal-os-router-test";
const { setPlaceholder, kernel } = vi.hoisted(() => {
  const setPlaceholder = !process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= "postgres://localhost/ooda-personal-os-router-test";
  return {
    setPlaceholder,
    kernel: {
      createConversation: vi.fn(),
      listConversations: vi.fn(),
      getConversationCompatible: vi.fn(),
      forkConversation: vi.fn(),
      archiveConversation: vi.fn(),
      appendConversationEvent: vi.fn(),
      correctConversationEvent: vi.fn(),
      listConversationEventsCompatible: vi.fn(),
    },
  };
});

vi.mock("../../../kernel", () => kernel);

afterAll(() => {
  if (setPlaceholder && process.env.DATABASE_URL === DATABASE_URL_PLACEHOLDER) {
    delete process.env.DATABASE_URL;
  }
});

import { conversationsRouter } from "../conversations";
import { eventsRouter } from "../events";
import { edgeRouter } from "../../edge-router";
import { handleOodaV1HttpRequest } from "../../openapi";
import { appRouter } from "../../root";
import { t } from "../../trpc";

const occurredAt = "2026-08-05T18:00:00.000Z";
const conversation = {
  id: "conversation-1",
  ownerId: "owner-a",
  title: "New thought",
  status: "active" as const,
  hostProvider: "grok",
  hostProfile: "daily",
  activeBranchId: "branch-1",
  lastSequence: "0",
  sensitivityCeiling: "personal" as const,
  ttsPolicy: "allowed" as const,
  createdAt: occurredAt,
  updatedAt: occurredAt,
};
const branch = {
  id: "branch-1",
  conversationId: "conversation-1",
  name: "main",
  createdAt: occurredAt,
  updatedAt: occurredAt,
};
const event = {
  id: "event-1",
  conversationId: "conversation-1",
  branchId: "branch-1",
  sequence: "1",
  type: "user_turn" as const,
  actor: { type: "user" as const, id: "owner-a" },
  payload: { display: "Hello" },
  sensitivity: "general" as const,
  correlationId: "router-test",
  idempotencyKey: "append-1",
  occurredAt,
};

const router = t.router({ conversations: conversationsRouter, events: eventsRouter });
const createCaller = t.createCallerFactory(router);
const auth = {
  api: {
    getSession: vi.fn().mockResolvedValue({
      user: { id: "owner-a", email: "owner@example.test" },
      session: { id: "session-1" },
    }),
  },
} as unknown as AuthInstance;

function caller() {
  return createCaller({ headers: new Headers(), auth, db: {} as never });
}

describe("personal OS routers", () => {
  it("mounts the same V1 conversation procedures in Node and edge routers", () => {
    const expected = [
      "conversations.archive",
      "conversations.create",
      "conversations.fork",
      "conversations.list",
      "conversations.retrieve",
      "events.append",
      "events.correct",
      "events.paginate",
    ];
    const nodeProcedures = Object.keys(appRouter._def.procedures);
    const edgeProcedures = Object.keys(edgeRouter._def.procedures);
    expect(expected.every((name) => nodeProcedures.includes(name))).toBe(true);
    expect(expected.every((name) => edgeProcedures.includes(name))).toBe(true);
  });

  it("passes authenticated ownership into conversation commands", async () => {
    kernel.createConversation.mockResolvedValue({ conversation, branch, replayed: false });
    const input = {
      title: "New thought",
      idempotencyKey: "create-1",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal" as const,
      ttsPolicy: "allowed" as const,
    };

    await expect(caller().conversations.create(input)).resolves.toEqual({
      conversation,
      branch,
      replayed: false,
    });
    expect(kernel.createConversation).toHaveBeenCalledWith({}, "owner-a", input);
  });

  it("serves the same create contract through the versioned HTTP resource", async () => {
    kernel.createConversation.mockResolvedValue({ conversation, branch, replayed: false });
    const response = await handleOodaV1HttpRequest({
      request: new Request("https://ooda.test/api/v1/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "New thought",
          idempotencyKey: "create-http-1",
          hostProvider: "grok",
          hostProfile: "daily",
          sensitivityCeiling: "personal",
          ttsPolicy: "allowed",
        }),
      }),
      createContext: async () => ({
        headers: new Headers(),
        auth,
        db: {} as never,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversation,
      branch,
      replayed: false,
    });
  });

  it("exposes paged event reads and append receipts", async () => {
    kernel.appendConversationEvent.mockResolvedValue({ event, replayed: false });
    kernel.listConversationEventsCompatible.mockResolvedValue({
      items: [event],
      pageInfo: { hasMore: false },
    });
    const appendInput = {
      conversationId: "conversation-1",
      branchId: "branch-1",
      type: "user_turn" as const,
      actor: { type: "user" as const, id: "owner-a" },
      payload: { display: "Hello" },
      sensitivity: "general" as const,
      correlationId: "router-test",
      idempotencyKey: "append-1",
      occurredAt,
    };

    await expect(caller().events.append(appendInput)).resolves.toEqual({
      event,
      replayed: false,
    });
    await expect(
      caller().events.paginate({ conversationId: "conversation-1", limit: 100 }),
    ).resolves.toEqual({ items: [event], pageInfo: { hasMore: false } });
  });
});
