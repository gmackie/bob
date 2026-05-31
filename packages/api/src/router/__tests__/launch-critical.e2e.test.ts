import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chatConversations,
  dispatchBatches,
  dispatchItems,
  planDrafts,
  projects,
  prReviews,
  workspaceMembers,
  workspaces,
} from "@bob/db/schema";

const WORKSPACE_ID = "f47ac10b-58cc-4372-a567-0d02b2c3d479";
const PROJECT_ID = "6ba7b810-9dad-41d8-80b4-00c04fd430c8";
const SESSION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DRAFT_ID = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const BATCH_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const DISPATCH_ITEM_ID = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const TASK_RUN_ID = "5e6f7a8b-9c0d-4e1f-aa3b-4c5d6e7f8a9b";
const PULL_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const reviewRows = vi.hoisted(() => [] as any[]);
const createDraftPrMock = vi.hoisted(() => vi.fn());
const getPrByIdMock = vi.hoisted(() => vi.fn());
const executeTaskMock = vi.hoisted(() => vi.fn());

vi.mock("@bob/db/client", () => ({
  db: {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: any) => ({
        returning: vi.fn(() => {
          if (table === prReviews) {
            const row = {
              id: "review-1",
              pullRequestId: values.pullRequestId,
              userId: values.userId,
              status: values.status,
              body: values.body,
              createdAt: "2026-05-31T00:00:00.000Z",
            };
            reviewRows.push(row);
            return Promise.resolve([row]);
          }

          return Promise.resolve([]);
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.resolve(reviewRows)),
          })),
        })),
      })),
    })),
  },
}));

vi.mock("../../services/git/prService", () => ({
  createDraftPr: createDraftPrMock,
  getPrById: getPrByIdMock,
  linkPrToPlanningTask: vi.fn(),
  listAllPrs: vi.fn(),
  listPrsByRepository: vi.fn(),
  listPrsBySession: vi.fn(),
  mergePr: vi.fn(),
  refreshPrFromRemote: vi.fn(),
  syncCommits: vi.fn(),
  updatePr: vi.fn(),
}));

vi.mock("../../services/automation/pipeline-trigger", () => ({
  onPullRequestCreated: vi.fn(() => Promise.resolve()),
}));

vi.mock("@bob/execution/runtime/taskExecutor", () => ({
  executeTask: executeTaskMock,
}));

vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({
    ok: true,
    json: async () => [
      {
        result: {
          data: {
            json: {
              id: "planning-task-1",
              identifier: "LAUNCH-1",
            },
          },
        },
      },
    ],
  })),
);

let appRouter: typeof import("../../root").appRouter;

type RowStore = {
  workspaces: any[];
  workspaceMembers: any[];
  projects: any[];
  repositories: any[];
  chatConversations: any[];
  planDrafts: any[];
  planDraftDependencies: any[];
  dispatchBatches: any[];
  dispatchItems: any[];
  workItems: any[];
  agentRuns: any[];
};

function createRowStore(): RowStore {
  return {
    workspaces: [],
    workspaceMembers: [],
    projects: [],
    repositories: [],
    chatConversations: [],
    planDrafts: [],
    planDraftDependencies: [],
    dispatchBatches: [],
    dispatchItems: [],
    workItems: [],
    agentRuns: [],
  };
}

function createDb(store: RowStore) {
  const insertRows = (table: unknown, values: any) => {
    const rows = Array.isArray(values) ? values : [values];

    if (table === workspaces) {
      return rows.map((row) => {
        const workspace = { id: WORKSPACE_ID, ...row };
        store.workspaces.push(workspace);
        return workspace;
      });
    }

    if (table === projects) {
      return rows.map((row) => {
        const project = { id: PROJECT_ID, status: "planned", ...row };
        store.projects.push(project);
        return project;
      });
    }

    if (table === chatConversations) {
      return rows.map((row) => {
        const session = { id: SESSION_ID, ...row };
        store.chatConversations.push(session);
        return session;
      });
    }

    if (table === planDrafts) {
      return rows.map((row) => {
        const draft = { id: DRAFT_ID, status: "draft", ...row };
        store.planDrafts.push(draft);
        return draft;
      });
    }

    if (table === dispatchBatches) {
      return rows.map((row) => {
        const batch = { id: BATCH_ID, ...row };
        store.dispatchBatches.push(batch);
        return batch;
      });
    }

    if (table === dispatchItems) {
      return rows.map((row, index) => {
        const item = {
          id: index === 0 ? DISPATCH_ITEM_ID : crypto.randomUUID(),
          ...row,
        };
        store.dispatchItems.push(item);
        return item;
      });
    }

    const inserted = rows.map((row) => ({ id: crypto.randomUUID(), ...row }));
    if (table === workspaceMembers) {
      store.workspaceMembers.push(...inserted);
    }
    return inserted;
  };

  const updateRows = (table: unknown, values: any) => {
    if (table === chatConversations) {
      Object.assign(store.chatConversations[0], values);
      return [store.chatConversations[0]];
    }

    if (table === planDrafts) {
      for (const draft of store.planDrafts) {
        Object.assign(draft, values);
      }
      return store.planDrafts;
    }

    if (table === dispatchBatches) {
      Object.assign(store.dispatchBatches[0], values);
      return [store.dispatchBatches[0]];
    }

    if (table === dispatchItems) {
      Object.assign(store.dispatchItems[0], values);
      return [store.dispatchItems[0]];
    }

    return [];
  };

  const db: any = {
    insert: (table: unknown) => ({
      values: (values: any) => ({
        returning: () => Promise.resolve(insertRows(table, values)),
        onConflictDoNothing: () => Promise.resolve(),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: any) => ({
        where: () => {
          const updated = updateRows(table, values);
          return {
            returning: () => Promise.resolve(updated),
          };
        },
      }),
    }),
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    query: {
      workspaceMembers: {
        findFirst: () => Promise.resolve(store.workspaceMembers[0] ?? null),
        findMany: () =>
          Promise.resolve(
            store.workspaceMembers.map((membership) => ({
              ...membership,
              workspace: store.workspaces.find(
                (workspace) => workspace.id === membership.workspaceId,
              ),
            })),
          ),
      },
      projects: {
        findFirst: () => Promise.resolve(store.projects[0] ?? null),
        findMany: () => Promise.resolve(store.projects),
      },
      repositories: {
        findFirst: () => Promise.resolve(store.repositories[0] ?? null),
      },
      chatConversations: {
        findFirst: () => Promise.resolve(store.chatConversations[0] ?? null),
        findMany: () => Promise.resolve(store.chatConversations),
      },
      planDrafts: {
        findFirst: () => Promise.resolve(store.planDrafts[0] ?? null),
        findMany: () => Promise.resolve(store.planDrafts),
      },
      planDraftDependencies: {
        findMany: () => Promise.resolve(store.planDraftDependencies),
      },
      dispatchBatches: {
        findFirst: () => Promise.resolve(store.dispatchBatches[0] ?? null),
        findMany: () => Promise.resolve(store.dispatchBatches),
      },
      dispatchItems: {
        findFirst: () => Promise.resolve(store.dispatchItems[0] ?? null),
        findMany: () => Promise.resolve(store.dispatchItems),
      },
      workItems: {
        findFirst: () => Promise.resolve(store.workItems[0] ?? null),
        findMany: () => Promise.resolve(store.workItems),
      },
      agentRuns: {
        findFirst: () => Promise.resolve(store.agentRuns[0] ?? null),
        findMany: () => Promise.resolve(store.agentRuns),
      },
    },
  };

  return db;
}

function createCaller(store: RowStore) {
  return appRouter.createCaller({
    session: {
      session: {
        id: "auth-session-1",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        userId: "user-1",
        expiresAt: new Date("2026-03-11T00:00:00.000Z"),
        token: "token-1",
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: "user-1",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        email: "test@example.com",
        emailVerified: true,
        name: "Test User",
      },
    },
    authApi: { getSession: vi.fn() } as any,
    apiKeyAuth: null as any,
    db: createDb(store),
  });
}

describe("launch-critical E2E coverage", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    process.env.PLANNING_API_KEY = "test-planning-key";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    reviewRows.length = 0;
    createDraftPrMock.mockReset();
    getPrByIdMock.mockReset();
    executeTaskMock.mockReset();
    vi.mocked(fetch).mockClear();
  });

  it("covers the launch path from workspace setup through agent dispatch and PR review", async () => {
    const store = createRowStore();
    const caller = createCaller(store) as any;

    const workspace = await caller.workspace.create({
      name: "Launch Workspace",
      slug: "launch-workspace",
    });

    expect(workspace).toMatchObject({
      id: WORKSPACE_ID,
      ownerUserId: "user-1",
      name: "Launch Workspace",
    });
    expect(store.workspaceMembers[0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      userId: "user-1",
      role: "owner",
    });

    const project = await caller.project.create({
      workspaceId: WORKSPACE_ID,
      name: "Launch App",
      key: "lch",
    });
    expect(project).toMatchObject({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      key: "LCH",
    });

    const session = await caller.planSession.create({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      workingDirectory: "/repo",
      planningSessionType: "breakdown",
    });
    expect(session).toMatchObject({
      id: SESSION_ID,
      sessionType: "planning",
      status: "provisioning",
    });

    await expect(
      caller.planSession.start({
        sessionId: SESSION_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        projectName: "Launch App",
        workingDirectory: "/repo",
        launchContext: {
          intent: "breakdown",
          notes: "Plan launch-critical work",
          selectedRepoSources: [],
          attachedFiles: [],
        },
      }),
    ).resolves.toEqual({ ok: true, sessionId: SESSION_ID });
    expect(store.chatConversations[0]).toMatchObject({
      status: "pending",
      planningWorkspaceId: WORKSPACE_ID,
      planningProjectId: PROJECT_ID,
      planningProjectName: "Launch App",
    });

    const draft = await caller.planSession.createDraft({
      sessionId: SESSION_ID,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      title: "Ship onboarding gate",
      description: "Protect onboarding before launch",
      kind: "task",
      priority: "high",
    });
    expect(draft).toMatchObject({
      id: DRAFT_ID,
      status: "draft",
      title: "Ship onboarding gate",
    });

    const commit = await caller.planSession.commitPlan({
      sessionId: SESSION_ID,
    });
    expect(commit).toEqual({
      committed: 1,
      tasks: [
        {
          draftId: DRAFT_ID,
          taskId: "planning-task-1",
          identifier: "LAUNCH-1",
        },
      ],
    });
    expect(store.planDrafts[0]).toMatchObject({ status: "committed" });

    const batchResult = await caller.dispatch.createBatch({
      sessionId: SESSION_ID,
      concurrency: 1,
      tasks: commit.tasks,
    });
    expect(batchResult.batch).toMatchObject({
      id: BATCH_ID,
      status: "pending",
      totalTasks: 1,
    });
    expect(batchResult.items[0]).toMatchObject({
      id: DISPATCH_ITEM_ID,
      planningTaskId: "planning-task-1",
      planningTaskIdentifier: "LAUNCH-1",
      status: "queued",
    });

    executeTaskMock.mockResolvedValueOnce({ taskRunId: TASK_RUN_ID });
    await expect(
      caller.dispatch.dispatch({ batchId: BATCH_ID }),
    ).resolves.toEqual({ started: 1 });
    expect(executeTaskMock).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        id: "planning-task-1",
        identifier: "LAUNCH-1",
      }),
      { agentType: "smol-agent" },
    );
    expect(store.dispatchItems[0]).toMatchObject({
      status: "running",
      taskRunId: TASK_RUN_ID,
    });

    createDraftPrMock.mockResolvedValueOnce({
      id: PULL_REQUEST_ID,
      repositoryId: "22222222-2222-4222-8222-222222222222",
      title: "Ship onboarding gate",
      headBranch: "agent/launch-1",
      status: "draft",
    });
    getPrByIdMock.mockResolvedValue({
      id: PULL_REQUEST_ID,
      repositoryId: "22222222-2222-4222-8222-222222222222",
    });

    const pr = await caller.pullRequest.create({
      repositoryId: "22222222-2222-4222-8222-222222222222",
      sessionId: SESSION_ID,
      title: "Ship onboarding gate",
      headBranch: "agent/launch-1",
      draft: true,
      planningTaskId: "planning-task-1",
    });
    expect(createDraftPrMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: SESSION_ID,
        planningTaskId: "planning-task-1",
      }),
    );
    expect(pr).toMatchObject({ id: PULL_REQUEST_ID, status: "draft" });

    const review = await caller.pullRequest.addReview({
      pullRequestId: PULL_REQUEST_ID,
      status: "approved",
      body: "Ready for launch.",
    });
    expect(review).toMatchObject({
      pullRequestId: PULL_REQUEST_ID,
      status: "approved",
      userId: "user-1",
    });
  });

  it("covers the current billing gate behavior when Stripe is disabled", async () => {
    const { createBillingPortalSession, createCheckoutSession } =
      await import("@bob/payments");

    await expect(
      createCheckoutSession({
        mode: "subscription",
        line_items: [],
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      }),
    ).resolves.toBeNull();

    await expect(
      createBillingPortalSession({
        customer: "cus_launch",
        return_url: "https://example.com/account",
      }),
    ).resolves.toBeNull();
  });
});
