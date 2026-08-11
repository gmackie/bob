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
      searchMemories: vi.fn(),
      createMemoryContextSource: vi.fn().mockReturnValue({
        id: "memory",
        inspect: vi.fn(),
      }),
      resolveAgentJobPolicy: vi.fn().mockImplementation((jobClass: string) => ({
        provider: ["comparison", "synthesis", "opportunity_review"].includes(
          jobClass,
        )
          ? "claude"
          : "codex",
        capabilities: [],
        budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
      })),
      resolveContextSourceConfig: vi.fn().mockReturnValue({}),
      createConfiguredContextSources: vi.fn().mockReturnValue([]),
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
        billingPolicy: "subscription_only",
        capabilities: ["web.read"],
        budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
        createdAt: "2026-08-07T15:00:00.000Z",
        updatedAt: "2026-08-07T15:00:00.000Z",
      },
      replayed: false,
    });

    await caller().jobs.create(input);
    expect(kernel.createAgentJob).toHaveBeenCalledWith(
      {},
      "owner-jobs",
      input,
      {
        contextSources: [expect.objectContaining({ id: "memory" })],
        signal: expect.any(AbortSignal),
      },
    );
    expect(kernel.createMemoryContextSource).toHaveBeenCalledWith({
      search: expect.any(Function),
      excludeConversationId: "conversation-1",
    });
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
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "jobs");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-jobs");
    vi.stubEnv("OODA_AGENT_JOB_ENABLED_PROVIDERS", "codex");
    vi.stubEnv(
      "OODA_AGENT_JOB_ENABLED_CLASSES",
      "read_only_research,scratch_prototype",
    );
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
    expect(kernel.claimAgentJob).toHaveBeenCalledWith({}, input, {
      eligibleOwnerIds: ["owner-jobs"],
    });
  });

  it("does not let a trusted runner claim jobs after rollback", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "runner-secret");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "tts");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-jobs");

    await expect(
      caller(new Headers({ authorization: "Bearer runner-secret" })).jobs.claim(
        {
          runnerId: "runner-1",
          providers: ["codex"],
          classes: ["read_only_research"],
          leaseSeconds: 90,
        },
      ),
    ).resolves.toBeNull();
    expect(kernel.claimAgentJob).not.toHaveBeenCalled();
  });

  it("narrows trusted runner claims to enabled classes and providers", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "runner-secret");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "jobs");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-jobs");
    vi.stubEnv("OODA_AGENT_JOB_ENABLED_PROVIDERS", "codex");
    vi.stubEnv(
      "OODA_AGENT_JOB_ENABLED_CLASSES",
      "read_only_research,scratch_prototype",
    );
    kernel.claimAgentJob.mockResolvedValue(null);
    const headers = new Headers({ authorization: "Bearer runner-secret" });

    await caller(headers).jobs.claim({
      runnerId: "runner-1",
      providers: ["codex", "claude"],
      classes: ["read_only_research", "comparison"],
      leaseSeconds: 90,
    });
    expect(kernel.claimAgentJob).toHaveBeenCalledWith(
      {},
      {
        runnerId: "runner-1",
        providers: ["codex"],
        classes: ["read_only_research"],
        leaseSeconds: 90,
      },
      { eligibleOwnerIds: ["owner-jobs"] },
    );

    vi.clearAllMocks();
    await expect(
      caller(headers).jobs.claim({
        runnerId: "runner-1",
        providers: ["claude"],
        classes: ["comparison"],
        leaseSeconds: 90,
      }),
    ).resolves.toBeNull();
    expect(kernel.claimAgentJob).not.toHaveBeenCalled();
  });

  it("forces active runner control toward cancellation when killed", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "runner-secret");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "jobs");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-jobs");
    vi.stubEnv("OODA_ROLLOUT_KILL_SWITCH", "true");
    vi.stubEnv("OODA_AGENT_JOB_ENABLED_PROVIDERS", "codex");
    vi.stubEnv(
      "OODA_AGENT_JOB_ENABLED_CLASSES",
      "read_only_research,scratch_prototype",
    );
    const input = {
      jobId: "job-1",
      runnerId: "runner-1",
      leaseToken: "11111111-1111-4111-8111-111111111111",
    };
    kernel.inspectAgentJobControl.mockResolvedValue({
      status: "running",
      cancelRequested: true,
      attempt: 1,
    });

    await expect(
      caller(
        new Headers({ authorization: "Bearer runner-secret" }),
      ).jobs.control(input),
    ).resolves.toMatchObject({ cancelRequested: true });
    expect(kernel.inspectAgentJobControl).toHaveBeenCalledWith({}, input, {
      eligibleOwnerIds: [],
      enabledProviders: ["codex"],
      enabledClasses: ["read_only_research", "scratch_prototype"],
    });
  });

  it("keeps owner cancellation available while the kill switch is active", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "jobs");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-jobs");
    vi.stubEnv("OODA_ROLLOUT_KILL_SWITCH", "true");
    const input = { jobId: "job-1", idempotencyKey: "cancel-job-1" };
    kernel.cancelAgentJob.mockResolvedValue({
      job: {
        id: "job-1",
        conversationId: "conversation-1",
        class: "read_only_research",
        status: "cancelled",
        provider: "codex",
        billingPolicy: "subscription_only",
        capabilities: [],
        budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
        createdAt: "2026-08-07T15:00:00.000Z",
        updatedAt: "2026-08-07T15:00:00.000Z",
      },
      replayed: false,
    });

    await expect(caller().jobs.cancel(input)).resolves.toMatchObject({
      job: { status: "cancelled" },
    });
    expect(kernel.cancelAgentJob).toHaveBeenCalledWith({}, "owner-jobs", input);
  });

  it("restricts the initial jobs rollout to proven classes and providers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "jobs");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-jobs");
    vi.stubEnv("OODA_AGENT_JOB_ENABLED_PROVIDERS", "codex");
    vi.stubEnv(
      "OODA_AGENT_JOB_ENABLED_CLASSES",
      "read_only_research,scratch_prototype",
    );

    await expect(
      caller().jobs.create({
        conversationId: "conversation-1",
        class: "comparison",
        prompt: "Compare models",
        idempotencyKey: "job-comparison",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller().jobs.create({
        conversationId: "conversation-1",
        class: "read_only_research",
        provider: "claude",
        prompt: "Research this",
        idempotencyKey: "job-claude",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(kernel.createAgentJob).not.toHaveBeenCalled();
  });

  it("fails closed without runtime allowlists and accepts an enabled Codex class", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "jobs");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-jobs");
    vi.stubEnv("OODA_AGENT_JOB_ENABLED_PROVIDERS", "");
    vi.stubEnv("OODA_AGENT_JOB_ENABLED_CLASSES", "");
    const input = {
      conversationId: "conversation-1",
      class: "read_only_research" as const,
      prompt: "Research this",
      idempotencyKey: "job-codex-rollout",
    };

    await expect(caller().jobs.create(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(kernel.createAgentJob).not.toHaveBeenCalled();

    vi.stubEnv("OODA_AGENT_JOB_ENABLED_PROVIDERS", "codex");
    vi.stubEnv(
      "OODA_AGENT_JOB_ENABLED_CLASSES",
      "read_only_research,scratch_prototype",
    );
    kernel.createAgentJob.mockResolvedValue({
      job: {
        id: "job-codex-rollout",
        conversationId: "conversation-1",
        class: "read_only_research",
        status: "queued",
        provider: "codex",
        billingPolicy: "subscription_only",
        capabilities: [],
        budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
        createdAt: "2026-08-10T20:00:00.000Z",
        updatedAt: "2026-08-10T20:00:00.000Z",
      },
      replayed: false,
    });

    await expect(caller().jobs.create(input)).resolves.toMatchObject({
      job: { provider: "codex", class: "read_only_research" },
    });
    expect(kernel.createAgentJob).toHaveBeenCalledTimes(1);
  });
});
