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

function createRunnerDeviceSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, limit };
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

  it("accepts an additional runner secret without replacing the primary secret", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "current-secret");
    vi.stubEnv("OODA_RUNNER_ADDITIONAL_SECRETS", "gmacko-mini-secret");
    const device = { id: "runner-device-1" };
    const { db, inserted } = createInsertDb([device]);
    const deviceSelect = createRunnerDeviceSelect([]);
    const caller = createCaller({
      db: {
        ...(db as object),
        select: deviceSelect.select,
      },
      headers: new Headers({
        host: "localhost:3100",
        authorization: "Bearer gmacko-mini-secret",
      }),
    });

    await expect(
      caller.runner.register({
        name: "gmacko-mini",
        hostname: "gmacko-mini.local",
        capabilities: ["codex", "cursor-agent", "macos", "darwin"],
      }),
    ).resolves.toEqual([device]);
    expect(inserted).toHaveLength(1);
  });

  it("lists runner devices without selecting migration-only columns", async () => {
    const rows = [
      {
        id: "runner-1",
        name: "runner-hetzner-bob",
        hostname: "hetzner-bob",
        status: "online",
        lastHeartbeatAt: new Date("2026-06-08T07:00:00.000Z"),
        capabilities: ["codex", "claude"],
      },
    ];
    const from = vi.fn().mockResolvedValue(rows);
    const select = vi.fn(() => ({ from }));
    const caller = createCaller({
      db: { select },
    });

    await expect(caller.runner.listDevices()).resolves.toEqual(rows);
    expect(select).toHaveBeenCalledWith(
      expect.not.objectContaining({ registeredAt: expect.anything() }),
    );
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

  it("rejects a macOS-required prompt when the selected runner lacks macOS capability", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "runner-secret");
    const { db } = createInsertDb([{ id: "session-1" }]);
    const deviceSelect = createRunnerDeviceSelect([{
      id: "22222222-2222-4222-8222-222222222222",
      capabilities: ["codex", "linux"],
    }]);
    const caller = createCaller({
      db: {
        ...(db as object),
        select: deviceSelect.select,
      },
    });

    await expect(
      caller.runner.sendPrompt({
        threadId: "11111111-1111-4111-8111-111111111111",
        runnerId: "22222222-2222-4222-8222-222222222222",
        adapterId: "codex",
        toolProfileId: "default",
        prompt: "Run the macOS signing check.",
        requiredCapabilities: ["macos"],
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("macos"),
    });
    expect(deviceSelect.where).toHaveBeenCalled();
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
