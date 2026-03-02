import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatConversations } from "@bob/db/schema";
import { appRouter } from "../../root";

const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertReturningMock = vi.fn();

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
      user: {
        id: session.id,
      },
    },
    authApi: { getSession: vi.fn() } as any,
    apiKeyAuth: null as any,
    db: makeDbMock() as any,
  });

describe("session.bootstrapForChat", () => {
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
      } as any,
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
