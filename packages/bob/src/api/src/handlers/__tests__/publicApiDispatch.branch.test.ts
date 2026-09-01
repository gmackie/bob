import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "@bob/db/client";
import {
  chatConversations,
  taskRuns,
  workItems,
} from "@bob/db/schema";

import { publicApiDispatchExecution } from "../publicApi.js";

// The gate + tenant scoping are covered in publicApiDispatch.test.ts. This suite
// exercises the branch/autonomy/model wiring added for headless dispatch:
//   1. a taskRuns row keyed to the session (so relay.ts can hand the runner a
//      branch → worktree + push + PR),
//   2. personaMetadata.autonomyLevel defaulting to "full" (so the runner uses
//      permissionMode "skip" and doesn't hang), plus model passthrough,
//   3. branch in the response.
// The DB is mocked at the drizzle-call level; @bob/db/schema stays real so the
// insert routing keys off the actual table objects.

vi.mock("@bob/db", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  desc: (col: unknown) => ({ desc: col }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("../../services/quotas/index.js", () => ({
  assertWithinQuotaOrThrow: vi.fn().mockResolvedValue(undefined),
}));

const WORKSPACE_ID = "00000000-0000-0000-0000-0000000000ff";
const TENANT_ID = "tenant-1";
const WORK_ITEM_ID = "1a2b3c4d-0000-0000-0000-000000000000";
const SESSION_ID = "5e5e5e5e-0000-0000-0000-000000000000";
const TASK_RUN_ID = "7a7a7a7a-0000-0000-0000-000000000000";

interface CapturedInsert {
  table: unknown;
  values: Record<string, unknown>;
}

function makeDb(captured: CapturedInsert[]): Db {
  return {
    query: {
      workspaces: {
        findFirst: () =>
          Promise.resolve({
            id: WORKSPACE_ID,
            tenantId: TENANT_ID,
            defaultAgentType: "codex",
          }),
      },
      tenantMembers: {
        findMany: () => Promise.resolve([{ tenantId: TENANT_ID }]),
      },
    },
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ n: 0 }]),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        captured.push({ table, values });
        return {
          returning: () => {
            if (table === workItems) {
              return Promise.resolve([{ id: WORK_ITEM_ID }]);
            }
            if (table === chatConversations) {
              return Promise.resolve([{ id: SESSION_ID, status: "pending" }]);
            }
            if (table === taskRuns) {
              return Promise.resolve([{ id: TASK_RUN_ID }]);
            }
            return Promise.resolve([{}]);
          },
        };
      },
    }),
  } as unknown as Db;
}

function find(captured: CapturedInsert[], table: unknown) {
  return captured.find((c) => c.table === table)?.values;
}

describe("publicApiDispatchExecution — branch + persona wiring", () => {
  const original = process.env.BOB_OODA_DISPATCH_ENABLED;
  beforeEach(() => {
    process.env.BOB_OODA_DISPATCH_ENABLED = "true";
    delete process.env.GATEWAY_URL;
    delete process.env.NUDGE_SHARED_SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.BOB_OODA_DISPATCH_ENABLED;
    else process.env.BOB_OODA_DISPATCH_ENABLED = original;
  });

  it("creates a taskRuns row keyed to the session with the run branch", async () => {
    const captured: CapturedInsert[] = [];
    const db = makeDb(captured);

    const result = await publicApiDispatchExecution(
      { db, userId: "user-1" },
      {
        workspaceId: WORKSPACE_ID,
        title: "Fix the login bug",
        agentType: "claude",
      },
    );

    const run = find(captured, taskRuns);
    expect(run).toBeDefined();
    expect(run).toMatchObject({
      sessionId: SESSION_ID,
      workItemId: WORK_ITEM_ID,
      planningWorkspaceId: WORKSPACE_ID,
      planningItemId: WORK_ITEM_ID,
      planningItemIdentifier: "1a2b3c4d",
      workItemIdentifierSnapshot: "1a2b3c4d",
      status: "starting",
      branch: "bob/1a2b3c4d/fix-the-login-bug",
    });
    // Response carries the branch and identifier.
    expect(result).toMatchObject({
      sessionId: SESSION_ID,
      workItemId: WORK_ITEM_ID,
      identifier: "1a2b3c4d",
      branch: "bob/1a2b3c4d/fix-the-login-bug",
      status: "pending",
    });
    // Session row records the same branch and is delivered to the runner.
    const session = find(captured, chatConversations);
    expect(session?.gitBranch).toBe("bob/1a2b3c4d/fix-the-login-bug");
  });

  it("defaults autonomyLevel to 'full' so the runner won't hang", async () => {
    const captured: CapturedInsert[] = [];
    const db = makeDb(captured);

    await publicApiDispatchExecution(
      { db, userId: "user-1" },
      { workspaceId: WORKSPACE_ID, title: "Do a thing", agentType: "claude" },
    );

    const session = find(captured, chatConversations);
    const personaMetadata = session?.personaMetadata as Record<string, unknown>;
    expect(personaMetadata.autonomyLevel).toBe("full");
    expect(personaMetadata.model).toBeUndefined();
  });

  it("honors an explicit autonomyLevel of 'prompt'", async () => {
    const captured: CapturedInsert[] = [];
    const db = makeDb(captured);

    await publicApiDispatchExecution(
      { db, userId: "user-1" },
      {
        workspaceId: WORKSPACE_ID,
        title: "Do a thing",
        agentType: "claude",
        autonomyLevel: "prompt",
      },
    );

    const session = find(captured, chatConversations);
    const personaMetadata = session?.personaMetadata as Record<string, unknown>;
    expect(personaMetadata.autonomyLevel).toBe("prompt");
  });

  it("threads the model override into personaMetadata", async () => {
    const captured: CapturedInsert[] = [];
    const db = makeDb(captured);

    await publicApiDispatchExecution(
      { db, userId: "user-1" },
      {
        workspaceId: WORKSPACE_ID,
        title: "Do a thing",
        agentType: "claude",
        model: "claude-sonnet-4",
      },
    );

    const session = find(captured, chatConversations);
    const personaMetadata = session?.personaMetadata as Record<string, unknown>;
    expect(personaMetadata.model).toBe("claude-sonnet-4");
  });

  it("keeps the ooda correlation nested under metadata", async () => {
    const captured: CapturedInsert[] = [];
    const db = makeDb(captured);

    await publicApiDispatchExecution(
      { db, userId: "user-1" },
      {
        workspaceId: WORKSPACE_ID,
        title: "Do a thing",
        agentType: "claude",
        ooda: { threadId: "thread-1" },
      },
    );

    const session = find(captured, chatConversations);
    const personaMetadata = session?.personaMetadata as Record<string, unknown>;
    expect(personaMetadata.metadata).toEqual({ ooda: { threadId: "thread-1" } });
    expect(personaMetadata.autonomyLevel).toBe("full");
  });
});
