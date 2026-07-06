import { afterAll, describe, expect, it, vi } from "vitest";

import type { AuthInstance } from "@gmacko/core/auth";

// Only set as a placeholder so importing ../../trpc (which transitively
// requires DATABASE_URL to be set, see ../../db/client.ts) doesn't throw at
// module-load time -- this router is fully mocked below and never actually
// connects to Postgres. vitest's default `threads` pool reuses a single
// worker (and its process.env) across multiple test files, so leaving this
// set after the file finishes can leak a fake DATABASE_URL into whichever
// test file runs next in the same worker -- notably
// src/db/__tests__/listen-broker.test.ts, which gates its real-Postgres
// LISTEN/NOTIFY suite on `Boolean(process.env.DATABASE_URL)` and doesn't
// expect to see this placeholder. Only clean up if we're the one who set it
// (respect the `??=` -- don't clobber a real DATABASE_URL some other file or
// the environment legitimately set).
const DATABASE_URL_PLACEHOLDER = "postgres://localhost/ooda-router-test";
const { setPlaceholder } = vi.hoisted(() => {
  const setPlaceholder = !process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= "postgres://localhost/ooda-router-test";
  return { setPlaceholder };
});

afterAll(() => {
  if (setPlaceholder && process.env.DATABASE_URL === DATABASE_URL_PLACEHOLDER) {
    delete process.env.DATABASE_URL;
  }
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
