import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthInstance } from "@gmacko/core/auth";

vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgres://localhost/ooda-rollout-procedure-test";
});

import { rolloutProcedure, t } from "../trpc";

const auth = {
  api: {
    getSession: vi.fn().mockResolvedValue({
      user: { id: "owner-1", email: "owner@example.test" },
      session: { id: "session-1" },
    }),
  },
} as unknown as AuthInstance;

const router = t.router({
  write: rolloutProcedure("conversation_write").query(() => "allowed"),
  jobs: rolloutProcedure("agent_jobs").query(() => "allowed"),
});
const createCaller = t.createCallerFactory(router);

afterEach(() => {
  delete process.env.OODA_ROLLOUT_STAGE;
  delete process.env.OODA_ROLLOUT_OWNER_IDS;
  delete process.env.OODA_ROLLOUT_KILL_SWITCH;
});

describe("rolloutProcedure", () => {
  it("allows capabilities reached by the account-scoped stage", async () => {
    process.env.OODA_ROLLOUT_STAGE = "mobile_text";
    process.env.OODA_ROLLOUT_OWNER_IDS = "owner-1";

    const caller = createCaller({
      headers: new Headers(),
      auth,
      db: {} as never,
    });
    await expect(caller.write()).resolves.toBe("allowed");
    await expect(caller.jobs()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("denies writes when the global kill switch is active", async () => {
    process.env.OODA_ROLLOUT_STAGE = "reviews_push";
    process.env.OODA_ROLLOUT_OWNER_IDS = "owner-1";
    process.env.OODA_ROLLOUT_KILL_SWITCH = "true";

    const caller = createCaller({
      headers: new Headers(),
      auth,
      db: {} as never,
    });
    await expect(caller.write()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
