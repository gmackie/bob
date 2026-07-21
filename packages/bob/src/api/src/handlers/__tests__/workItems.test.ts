import { afterEach, describe, expect, it, vi } from "vitest";

import { workItemsGet, workItemsList, workItemsReorderQueue, workItemsUpdate } from "../workItems";
import type { HandlerContext } from "../context";

const DASHBOARD_ACTIVE_SESSION_STATUSES = [
  "queued",
  "running",
  "starting",
  "provisioning",
  "pending",
  "awaiting-input",
  "awaiting_input",
];

/** Minimal shape of a drizzle relational-query call's options arg, for
 * inspecting the `where` clause built by handler code under test. */
interface QueryCallArgs {
  where?: unknown;
}

function extractSqlParamValues(value: unknown): unknown[] {
  const seen = new WeakSet<object>();
  const values: unknown[] = [];

  function visit(entry: unknown) {
    if (entry === null || entry === undefined) return;
    if (typeof entry !== "object") return;
    if (seen.has(entry)) return;
    seen.add(entry);

    if ("value" in entry && entry.constructor.name === "Param") {
      values.push(entry.value);
      return;
    }

    if (Array.isArray(entry)) {
      for (const child of entry) visit(child);
      return;
    }

    const maybeChunks = (entry as { queryChunks?: unknown }).queryChunks;
    if (maybeChunks) visit(maybeChunks);
  }

  visit(value);
  return values;
}

describe("work item handlers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GATEWAY_URL;
    delete process.env.NUDGE_SHARED_SECRET;
  });

  it("uses dashboard-active session statuses when linking agents in work item lists", async () => {
    const workItem = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333",
      sequenceNumber: 8,
      externalId: null,
      title: "Run task",
      kind: "task",
      status: "in_progress",
    };
    const db = {
      query: {
        workItems: {
          findMany: vi.fn().mockResolvedValue([workItem]),
        },
        workspaceMembers: {
          findFirst: vi.fn().mockResolvedValue({ id: "member-1" }),
        },
        projects: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: workItem.projectId,
              key: "P1",
              name: "Project",
            },
          ]),
        },
        chatConversations: {
          findMany: vi.fn<(args: QueryCallArgs) => Promise<unknown[]>>().mockResolvedValue([]),
        },
      },
    };

    await workItemsList(
      { db: db as unknown as HandlerContext["db"], userId: "user-1" },
      { workspaceId: workItem.workspaceId },
    );

    const query = db.query.chatConversations.findMany.mock.calls[0]?.[0];
    expect(extractSqlParamValues(query?.where)).toEqual(
      expect.arrayContaining(DASHBOARD_ACTIVE_SESSION_STATUSES),
    );
  });

  it("uses dashboard-active session statuses when linking agents in work item details", async () => {
    const workItem = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333",
      sequenceNumber: 8,
      externalId: null,
      title: "Run task",
      kind: "task",
      status: "in_progress",
    };
    const db = {
      query: {
        workItems: {
          findFirst: vi.fn().mockResolvedValue(workItem),
          findMany: vi.fn().mockResolvedValue([]),
        },
        workspaceMembers: {
          findFirst: vi.fn().mockResolvedValue({ id: "member-1" }),
        },
        projects: {
          findFirst: vi.fn().mockResolvedValue({
            id: workItem.projectId,
            key: "P1",
            name: "Project",
          }),
        },
        workItemArtifacts: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        chatConversations: {
          findFirst: vi.fn<(args: QueryCallArgs) => Promise<unknown>>().mockResolvedValue(null),
        },
        workItemDependencies: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    };

    await workItemsGet(
      { db: db as unknown as HandlerContext["db"], userId: "user-1" },
      { id: workItem.id },
    );

    const query = db.query.chatConversations.findFirst.mock.calls[0]?.[0];
    expect(extractSqlParamValues(query?.where)).toEqual(
      expect.arrayContaining(DASHBOARD_ACTIVE_SESSION_STATUSES),
    );
  });

  it("includes active execution session status in work item details", async () => {
    const workItem = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333",
      sequenceNumber: 8,
      externalId: null,
      title: "Run task",
      kind: "task",
      status: "in_progress",
    };
    const db = {
      query: {
        workItems: {
          findFirst: vi.fn().mockResolvedValue(workItem),
          findMany: vi.fn().mockResolvedValue([]),
        },
        workspaceMembers: {
          findFirst: vi.fn().mockResolvedValue({ id: "member-1" }),
        },
        projects: {
          findFirst: vi.fn().mockResolvedValue({
            id: workItem.projectId,
            key: "P1",
            name: "Project",
          }),
        },
        workItemArtifacts: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        chatConversations: {
          findFirst: vi.fn().mockResolvedValue({
            id: "session-1",
            workItemId: workItem.id,
            status: "running",
            agentType: "codex",
          }),
        },
        workItemDependencies: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    };

    const result = await workItemsGet(
      { db: db as unknown as HandlerContext["db"], userId: "user-1" },
      { id: workItem.id },
    );

    expect(result?.workItem.agentStatus).toEqual({
      sessionId: "session-1",
      status: "running",
      agentType: "codex",
    });
  });

  it("includes dependency and blocked-dependent summaries in work item details", async () => {
    const workItem = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333",
      sequenceNumber: 8,
      externalId: null,
      title: "Run task",
      kind: "task",
      status: "ready",
    };
    const db = {
      query: {
        workItems: {
          findFirst: vi.fn().mockResolvedValue(workItem),
          findMany: vi.fn().mockResolvedValue([]),
        },
        workspaceMembers: {
          findFirst: vi.fn().mockResolvedValue({ id: "member-1" }),
        },
        projects: {
          findFirst: vi.fn().mockResolvedValue({
            id: workItem.projectId,
            key: "P1",
            name: "Project",
          }),
        },
        workItemArtifacts: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        chatConversations: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        workItemDependencies: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce([
              {
                dependsOn: {
                  id: "dep-1",
                  externalId: null,
                  sequenceNumber: 7,
                  projectId: workItem.projectId,
                  title: "Complete competitor matrix",
                  status: "in_progress",
                },
              },
            ])
            .mockResolvedValueOnce([
              {
                workItem: {
                  id: "dependent-1",
                  externalId: null,
                  sequenceNumber: 9,
                  projectId: workItem.projectId,
                  title: "Publish positioning summary",
                  status: "ready",
                },
              },
            ]),
        },
      },
    };

    const result = await workItemsGet(
      { db: db as unknown as HandlerContext["db"], userId: "user-1" },
      { id: workItem.id },
    );

    expect(result?.workItem.dependencies).toEqual([
      {
        id: "dep-1",
        identifier: "P1-7",
        title: "Complete competitor matrix",
        status: "in_progress",
      },
    ]);
    expect(result?.workItem.dependents).toEqual([
      {
        id: "dependent-1",
        identifier: "P1-9",
        title: "Publish positioning summary",
        status: "ready",
      },
    ]);
  });

  it("publishes queue order changes to workspace subscribers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);
    process.env.GATEWAY_URL = "http://gw.local";
    process.env.NUDGE_SHARED_SECRET = "shh";
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const db = {
      query: {
        workspaceMembers: {
          findFirst: vi.fn().mockResolvedValue({ id: "member-1" }),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: updateWhere,
        })),
      })),
    };

    await workItemsReorderQueue(
      { db: db as unknown as HandlerContext["db"], userId: "user-1" },
      {
        workspaceId: "22222222-2222-4222-8222-222222222222",
        workItemIds: [
          "11111111-1111-4111-8111-111111111111",
          "33333333-3333-4333-8333-333333333333",
        ],
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw.local/internal/workspace-event",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer shh",
        },
        body: JSON.stringify({
          type: "queue_order_changed",
          workspaceId: "22222222-2222-4222-8222-222222222222",
          entityId: "11111111-1111-4111-8111-111111111111",
          payload: {
            workItemIds: [
              "11111111-1111-4111-8111-111111111111",
              "33333333-3333-4333-8333-333333333333",
            ],
          },
        }),
      }),
    );
  });

  it("publishes task status changes to workspace subscribers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);
    process.env.GATEWAY_URL = "http://gw.local";
    process.env.NUDGE_SHARED_SECRET = "shh";
    const workItem = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      title: "Run task",
      description: null,
      status: "ready",
    };
    const db = {
      query: {
        workItems: {
          findFirst: vi.fn().mockResolvedValue(workItem),
        },
        workspaceMembers: {
          findFirst: vi.fn().mockResolvedValue({ id: "member-1" }),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              {
                ...workItem,
                status: "in_progress",
              },
            ]),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn().mockResolvedValue(undefined),
      })),
    };

    await workItemsUpdate(
      { db: db as unknown as HandlerContext["db"], userId: "user-1" },
      {
        id: workItem.id,
        status: "in_progress",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw.local/internal/workspace-event",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer shh",
        },
        body: JSON.stringify({
          type: "task_status_changed",
          workspaceId: workItem.workspaceId,
          entityId: workItem.id,
          payload: {
            previousStatus: "ready",
            status: "in_progress",
          },
        }),
      }),
    );
  });

  it("publishes task priority changes to workspace subscribers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);
    process.env.GATEWAY_URL = "http://gw.local";
    process.env.NUDGE_SHARED_SECRET = "shh";
    const workItem = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      title: "Run task",
      description: null,
      status: "ready",
      priority: "low",
    };
    const db = {
      query: {
        workItems: {
          findFirst: vi.fn().mockResolvedValue(workItem),
        },
        workspaceMembers: {
          findFirst: vi.fn().mockResolvedValue({ id: "member-1" }),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([
              {
                ...workItem,
                priority: "high",
              },
            ]),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn().mockResolvedValue(undefined),
      })),
    };

    await workItemsUpdate(
      { db: db as unknown as HandlerContext["db"], userId: "user-1" },
      {
        id: workItem.id,
        priority: "high",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw.local/internal/workspace-event",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer shh",
        },
        body: JSON.stringify({
          type: "task_priority_changed",
          workspaceId: workItem.workspaceId,
          entityId: workItem.id,
          payload: {
            previousPriority: "low",
            priority: "high",
          },
        }),
      }),
    );
  });
});
