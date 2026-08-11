import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthInstance } from "@gmacko/core/auth";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://localhost/ooda-bob-rollout-test";
});

import { bobRouter } from "../bob";
import { t } from "../../trpc";

const auth = {
  api: {
    getSession: vi.fn().mockResolvedValue({
      user: { id: "owner-bob", email: "owner@example.test" },
      session: { id: "session-1" },
    }),
  },
} as unknown as AuthInstance;
const router = t.router({ bob: bobRouter });
const createCaller = t.createCallerFactory(router);

function caller() {
  return createCaller({ headers: new Headers(), auth, db: {} as never });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Bob rollout gates", () => {
  it("keeps dispatch and project creation dark before durable-work rollout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "jobs");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-bob");
    vi.stubEnv("BOB_API_URL", "https://bob.example.test");
    vi.stubEnv("BOB_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("BOB_WORKSPACE_ID", "workspace-1");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      caller().bob.dispatch({ threadSlug: "thread-1", title: "Do work" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().bob.createProject({ threadSlug: "thread-1", name: "Project" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
