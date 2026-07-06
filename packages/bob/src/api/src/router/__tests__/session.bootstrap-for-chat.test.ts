import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { chatConversations } from "@bob/db/schema";
import type { createTRPCContext } from "../../trpc.js";

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the insert surface these handlers
// actually call, cast through `unknown` (not `any`) at the single
// construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

let appRouter: typeof import("../../root").appRouter;

const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertReturningMock = vi.fn<() => Promise<Record<string, unknown>[]>>();

const makeDbMock = () => ({
  insert: (table: unknown) => {
    dbInsertMock(table);

    return {
      values: (values: unknown) => {
        dbInsertValuesMock(values);

        return {
          returning: () => dbInsertReturningMock(),
        };
      },
    };
  },
});

const createCaller = (session: { id: string }) =>
  appRouter.createCaller({
    session: {
      session: {
        id: "auth-session-1",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        userId: session.id,
        expiresAt: new Date("2026-03-11T00:00:00.000Z"),
        token: "token-1",
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: session.id,
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        email: "test@example.com",
        emailVerified: true,
        name: "Test User",
      },
    },
    authApi: { getSession: vi.fn() },
    apiKeyAuth: null,
    db: makeDbMock(),
  } as unknown as TRPCContext);

describe("session.bootstrapForChat", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    dbInsertMock.mockReset();
    dbInsertValuesMock.mockReset();
    dbInsertReturningMock.mockReset();
  });

  it("creates a session row and returns gateway bootstrap metadata", async () => {
    dbInsertReturningMock.mockResolvedValueOnce([
      {
        id: "session-id-1",
        userId: "user-id-1",
        workingDirectory: "/repo/demo",
      },
    ]);

    const caller = createCaller({ id: "user-id-1" });

    const result = await caller.session.bootstrapForChat({
      workingDirectory: "/repo/demo",
      agentType: "opencode",
    });

    expect(dbInsertMock).toHaveBeenCalledWith(chatConversations);
    expect(dbInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-id-1",
        workingDirectory: "/repo/demo",
        status: "provisioning",
      }),
    );
    expect(result).toEqual({
      id: "session-id-1",
      userId: "user-id-1",
      workingDirectory: "/repo/demo",
      gateway: {
        url: "ws://localhost:3002/sessions",
        shouldStartOnConnect: true,
      },
    });
  });
});
