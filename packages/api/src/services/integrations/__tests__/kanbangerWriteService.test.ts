import { beforeEach, describe, expect, it, vi } from "vitest";

const findConversationMock = vi.fn();
const findTaskRunMock = vi.fn();

vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      chatConversations: {
        findFirst: findConversationMock,
      },
      taskRuns: {
        findFirst: findTaskRunMock,
      },
    },
  },
}));

vi.mock("@bob/db", () => ({
  and: vi.fn((...args) => args),
  desc: vi.fn((value) => value),
  eq: vi.fn((left, right) => ({ left, right })),
}));

describe("planningWriteService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PLANNING_URL;
    delete process.env.PLANNING_API_KEY;
    process.env.KANBANGER_URL = "https://tasks.example.com";
    process.env.KANBANGER_API_KEY = "test-api-key";

    findConversationMock.mockResolvedValue({
      id: "session-123",
      userId: "user-123",
      kanbangerTaskId: "issue-123",
    });
    findTaskRunMock.mockResolvedValue({
      id: "run-123",
      sessionId: "session-123",
      userId: "user-123",
      kanbangerIssueId: "issue-123",
      kanbangerIssueIdentifier: "ENG-123",
    });
    global.fetch = vi.fn();
  });

  it("routes progress milestones through agent.syncBobRun", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            result: {
              data: {
                json: {
                  duplicated: false,
                },
              },
            },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { reportMilestone } = await import("../planningWriteService");

    await reportMilestone({
      userId: "user-123",
      sessionId: "session-123",
      kind: "progress",
      message: "Implemented Bob run sync router",
      phase: "implementation",
      progress: "1/2",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    const body = JSON.parse(init.body) as { "0": { json: Record<string, unknown> } };

    expect(url).toBe("https://tasks.example.com/api/trpc/agent.syncBobRun");
    expect(init.headers["X-API-Key"]).toBe("test-api-key");
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
    expect(body["0"].json).toMatchObject({
      issueId: "issue-123",
      taskRunId: "run-123",
      sessionId: "session-123",
      executionBackend: "bob",
      runStatus: "in_progress",
      workflowStatus: "working",
      latestSummary: "Implemented Bob run sync router",
    });
    expect(body["0"].json.idempotencyKey).toBeTruthy();
  });

  it("creates issue artifacts through issueArtifact.create", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              result: {
                data: {
                  json: {
                    id: "artifact-123",
                  },
                },
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              result: {
                data: {
                  json: {
                    id: "comment-456",
                  },
                },
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const { attachArtifact } = await import("../planningWriteService");

    await attachArtifact({
      userId: "user-123",
      sessionId: "session-123",
      artifactType: "doc",
      artifactRole: "documentation",
      url: "https://example.com/design-doc",
      title: "Design doc",
      summary: "Updated implementation notes",
    });

    const fetchCalls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, { body: string }]>;
    const artifactCall = fetchCalls.find(
      ([url]) => url === "https://tasks.example.com/api/trpc/issueArtifact.create",
    );

    expect(artifactCall).toBeDefined();
    const artifactBody = JSON.parse(artifactCall![1].body) as {
      "0": { json: Record<string, unknown> };
    };
    expect(artifactBody["0"].json).toMatchObject({
      issueId: "issue-123",
      agentTaskRunId: "run-123",
      executionBackend: "bob",
      producerType: "bob",
      artifactType: "doc",
      artifactRole: "documentation",
      url: "https://example.com/design-doc",
      title: "Design doc",
      summary: "Updated implementation notes",
    });
  });

  it("records prompt comment ids in the Bob run projection after posting a question", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              result: {
                data: {
                  json: {
                    id: "comment-123",
                  },
                },
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              result: {
                data: {
                  json: {
                    duplicated: false,
                  },
                },
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const { requestInputPrompt } = await import("../planningWriteService");

    await requestInputPrompt({
      userId: "user-123",
      sessionId: "session-123",
      question: "Which path should I take?",
      options: ["A", "B"],
      defaultAction: "Take path A",
      timeoutMinutes: 30,
      expiresAt: new Date("2026-03-10T18:00:00.000Z"),
    });

    const [commentUrl] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string];
    const [syncUrl, syncInit] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[1] as [string, { body: string }];
    const syncBody = JSON.parse(syncInit.body) as {
      "0": { json: Record<string, unknown> };
    };

    expect(commentUrl).toBe("https://tasks.example.com/api/trpc/comment.create");
    expect(syncUrl).toBe("https://tasks.example.com/api/trpc/agent.syncBobRun");
    expect(syncBody["0"].json).toMatchObject({
      issueId: "issue-123",
      taskRunId: "run-123",
      sessionId: "session-123",
      executionBackend: "bob",
      workflowStatus: "awaiting_input",
      latestSummary: "Which path should I take?",
      lastPromptCommentId: "comment-123",
    });
    expect(syncBody["0"].json.idempotencyKey).toBeTruthy();
  });

  it("prefers planning env aliases when writing remote task updates", async () => {
    delete process.env.KANBANGER_URL;
    delete process.env.KANBANGER_API_KEY;
    process.env.PLANNING_URL = "https://planning.example.com";
    process.env.PLANNING_API_KEY = "planning-api-key";

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            result: {
              data: {
                json: {
                  duplicated: false,
                },
              },
            },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { reportMilestone } = await import("../planningWriteService");

    await reportMilestone({
      userId: "user-123",
      sessionId: "session-123",
      kind: "progress",
      message: "Moved aliases to planning config",
    });

    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, { headers: Record<string, string> }];

    expect(url).toBe(
      "https://planning.example.com/api/trpc/agent.syncBobRun",
    );
    expect(init.headers["X-API-Key"]).toBe("planning-api-key");
  });
});
