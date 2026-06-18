import { describe, expect, it, vi } from "vitest";

import type { AuthInstance } from "@gmacko/core/auth";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://localhost/ooda-router-test";
});

import { threadsEdgeRouter } from "../threads-edge";
import { t } from "../../trpc";

const testRouter = t.router({ threads: threadsEdgeRouter });
const createCallerRaw = t.createCallerFactory(testRouter);

const mockAuth = {
  api: {
    getSession: vi.fn().mockResolvedValue({
      user: { id: "test-user", email: "test@example.com" },
      session: { id: "mock-session-id" },
    }),
  },
} as unknown as AuthInstance;

function createInsertDb(returningRows: unknown[]) {
  const inserted: unknown[] = [];

  return {
    inserted,
    db: {
      insert: vi.fn(() => ({
        values: vi.fn((value: unknown) => {
          inserted.push(value);
          return {
            returning: vi.fn(async () => returningRows),
          };
        }),
      })),
    },
  };
}

function createCaller(ctx: { db: unknown; headers?: Headers; auth?: AuthInstance }) {
  return createCallerRaw({
    headers: new Headers({ host: "localhost:3100" }),
    auth: mockAuth,
    ...ctx,
  } as never);
}

describe("threadsEdgeRouter", () => {
  it("creates a thread through the edge-safe DB-only path", async () => {
    const thread = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Mobile Agent Chat",
      slug: "mobile-agent-chat",
      status: "active",
    };
    const { db, inserted } = createInsertDb([thread]);
    const caller = createCaller({ db });

    const result = await caller.threads.create({
      title: "Mobile Agent Chat",
      slug: "mobile-agent-chat",
    });

    expect(result).toEqual([thread]);
    expect(inserted).toEqual([
      {
        title: "Mobile Agent Chat",
        slug: "mobile-agent-chat",
        ownerId: "test-user",
      },
    ]);
  });
});
