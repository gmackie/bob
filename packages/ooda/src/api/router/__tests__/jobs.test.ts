import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { AuthInstance } from "@gmacko/core/auth";

const DATABASE_URL_PLACEHOLDER = "postgres://localhost/ooda-jobs-router-test";
const { setPlaceholder, kernel } = vi.hoisted(() => {
  const setPlaceholder = !process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= "postgres://localhost/ooda-jobs-router-test";
  return {
    setPlaceholder,
    kernel: {
      createAgentJob: vi.fn(),
      listAgentJobs: vi.fn(),
      getAgentJob: vi.fn(),
      cancelAgentJob: vi.fn(),
      claimAgentJob: vi.fn(),
      recordAgentJobEvent: vi.fn(),
      inspectAgentJobControl: vi.fn(),
    },
  };
});

vi.mock("../../../kernel", () => kernel);

afterAll(() => {
  if (setPlaceholder && process.env.DATABASE_URL === DATABASE_URL_PLACEHOLDER) {
    delete process.env.DATABASE_URL;
  }
});

import { jobsRouter } from "../jobs";
import { t } from "../../trpc";

const auth = {
  api: {
    getSession: vi.fn().mockResolvedValue({
      user: { id: "owner-jobs", email: "owner@example.test" },
      session: { id: "session-1" },
    }),
  },
} as unknown as AuthInstance;
const router = t.router({ jobs: jobsRouter });
const createCaller = t.createCallerFactory(router);

function caller(headers = new Headers()) {
  return createCaller({ headers, auth, db: {} as never });
}

describe("jobs router", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("passes the authenticated owner to user job commands", async () => {
    const input = {
      conversationId: "conversation-1",
      class: "read_only_research" as const,
      prompt: "Research this",
      idempotencyKey: "job-1",
    };
    kernel.createAgentJob.mockResolvedValue({
      job: {
        id: "job-1",
        conversationId: "conversation-1",
        class: "read_only_research",
        status: "queued",
        provider: "codex",
        capabilities: ["web.read"],
        budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
        createdAt: "2026-08-07T15:00:00.000Z",
        updatedAt: "2026-08-07T15:00:00.000Z",
      },
      replayed: false,
    });

    await caller().jobs.create(input);
    expect(kernel.createAgentJob).toHaveBeenCalledWith({}, "owner-jobs", input);
  });

  it("requires a configured runner secret for claims", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "");
    await expect(
      caller().jobs.claim({
        runnerId: "runner-1",
        providers: ["codex"],
        classes: ["read_only_research"],
        leaseSeconds: 90,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(kernel.claimAgentJob).not.toHaveBeenCalled();
  });

  it("accepts an authenticated trusted runner claim", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "runner-secret");
    kernel.claimAgentJob.mockResolvedValue(null);
    const input = {
      runnerId: "runner-1",
      providers: ["codex"],
      classes: ["read_only_research" as const],
      leaseSeconds: 90,
    };

    await expect(
      caller(new Headers({ authorization: "Bearer runner-secret" })).jobs.claim(
        input,
      ),
    ).resolves.toBeNull();
    expect(kernel.claimAgentJob).toHaveBeenCalledWith({}, input);
  });
});
