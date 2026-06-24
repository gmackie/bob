import { describe, expect, it, vi } from "vitest";

import {
  createBobRuntimeMirrorSidecar,
  mirrorRuntimeEventWithPostgres,
  type MirrorRuntimeEventInput,
  type SqlPoolLike,
} from "./bobRuntimeMirrorSidecar.js";

function buildRuntimeEvent(
  overrides: Partial<MirrorRuntimeEventInput> = {},
): MirrorRuntimeEventInput {
  return {
    taskRunId: "56911254-58ba-487a-a86d-e431c41e65bb",
    status: "working",
    message: "probe from test",
    ...overrides,
  };
}

describe("bob runtime mirror sidecar", () => {
  it("accepts bypass-authorized runtime events and forwards them to the repository", async () => {
    const mirrorEvent = vi.fn().mockResolvedValue({ ok: true });
    const sidecar = createBobRuntimeMirrorSidecar({
      bypassToken: "prod-secret",
      repository: { mirrorEvent },
    });

    const response = await sidecar.handle(
      new Request("http://127.0.0.1:3301/api/v1/t3code/runtime-events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer bob-auth-bypass:prod-secret",
        },
        body: JSON.stringify(buildRuntimeEvent()),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mirrorEvent).toHaveBeenCalledWith(buildRuntimeEvent());
  });

  it("rejects requests without the configured bypass token", async () => {
    const sidecar = createBobRuntimeMirrorSidecar({
      bypassToken: "prod-secret",
      repository: { mirrorEvent: vi.fn() },
    });

    const response = await sidecar.handle(
      new Request("http://127.0.0.1:3301/api/v1/t3code/runtime-events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(buildRuntimeEvent()),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("increments next_seq numerically even when pg returns bigint fields as strings", async () => {
    const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
    const client = {
      async query<T>(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes("select id, session_id from task_runs where id = $1")) {
          return {
            rows: [
              {
                id: "56911254-58ba-487a-a86d-e431c41e65bb",
                session_id: "0485c6c6-cafb-468b-a878-4e7bdfc183ec",
              },
            ],
          } satisfies { rows: T[] };
        }
        if (text.includes("select id, user_id, next_seq from chat_conversations")) {
          return {
            rows: [
              {
                id: "0485c6c6-cafb-468b-a878-4e7bdfc183ec",
                user_id: "hetzner-bob-user",
                next_seq: "41",
              },
            ],
          } satisfies { rows: T[] };
        }
        return { rows: [] } satisfies { rows: T[] };
      },
      release() {},
    };

    const pool: SqlPoolLike = {
      async connect() {
        return client;
      },
    };

    const result = await mirrorRuntimeEventWithPostgres(pool, {
      bypassUserId: "hetzner-bob-user",
      event: buildRuntimeEvent({
        status: "completed",
        message: "turn finished",
      }),
    });

    expect(result).toEqual({ ok: true });
    expect(queries.map((entry) => entry.text)).toEqual(
      expect.arrayContaining([
        "begin",
        expect.stringContaining("select id, session_id from task_runs where id = $1"),
        expect.stringContaining(
          "select id, user_id, next_seq from chat_conversations where id = $1 limit 1",
        ),
        expect.stringContaining("update chat_conversations"),
        expect.stringContaining("insert into session_events"),
        expect.stringContaining("update task_runs"),
        "commit",
      ]),
    );
    const taskRunUpdate = queries.find((entry) =>
      entry.text.includes("update task_runs"),
    );
    expect(taskRunUpdate?.values?.[1]).toBe("completed");
    expect(queries).toContainEqual({
      text: "update chat_conversations set next_seq = $2 where id = $1",
      values: ["0485c6c6-cafb-468b-a878-4e7bdfc183ec", 42],
    });
    expect(queries).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining("insert into session_events"),
        values: expect.arrayContaining([
          "0485c6c6-cafb-468b-a878-4e7bdfc183ec",
          41,
        ]),
      }),
    );
  });
});
