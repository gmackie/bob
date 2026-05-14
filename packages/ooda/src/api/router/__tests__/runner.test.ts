import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthInstance } from "@gmacko/core/auth";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://localhost/ooda-router-test";
});

import { runnerRouter } from "../runner";
import { t } from "../../trpc";

const testRouter = t.router({ runner: runnerRouter });
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
            returning: vi.fn(async () => [returningRows.shift()]),
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

describe("runnerRouter user-facing enqueue mutations", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets an authenticated client enqueue a prompt without the runner secret", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "runner-secret");
    const session = { id: "session-1" };
    const { db, inserted } = createInsertDb([session]);
    const caller = createCaller({ db });

    const result = await caller.runner.sendPrompt({
      threadId: "11111111-1111-4111-8111-111111111111",
      runnerId: "22222222-2222-4222-8222-222222222222",
      adapterId: "codex",
      toolProfileId: "default",
      prompt: "Summarize this thread.",
    });

    expect(result).toEqual(session);
    expect(inserted).toEqual([
      {
        threadId: "11111111-1111-4111-8111-111111111111",
        runnerId: "22222222-2222-4222-8222-222222222222",
        adapterId: "codex",
        toolProfileId: "default",
        status: "pending",
      },
      {
        sessionId: "session-1",
        type: "prompt",
        content: "Summarize this thread.",
      },
    ]);
  });

  it("lets an authenticated client request promotion without the runner secret", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "runner-secret");
    const event = { id: "event-1" };
    const { db, inserted } = createInsertDb([event]);
    const caller = createCaller({ db });

    const result = await caller.runner.requestPromotion({
      sessionId: "33333333-3333-4333-8333-333333333333",
      runnerId: "22222222-2222-4222-8222-222222222222",
      threadId: "11111111-1111-4111-8111-111111111111",
      kind: "observation",
      title: "Worth saving",
      content: "This should become a note.",
    });

    expect(result).toEqual(event);
    expect(inserted).toEqual([
      {
        sessionId: "33333333-3333-4333-8333-333333333333",
        type: "promote_request",
        content: JSON.stringify({
          kind: "observation",
          title: "Worth saving",
          content: "This should become a note.",
          threadId: "11111111-1111-4111-8111-111111111111",
          runnerId: "22222222-2222-4222-8222-222222222222",
        }),
      },
    ]);
  });
});
