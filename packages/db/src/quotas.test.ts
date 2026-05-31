import { describe, expect, it, vi } from "vitest";

import {
  assertTenantQuota,
  assertUserQuota,
  assertWorkspaceQuota,
  PLAN_QUOTAS,
  QuotaExceededError,
} from "./quotas";

describe("tenant quota enforcement", () => {
  it("blocks free users after the API key limit", async () => {
    const db = {
      query: {
        tenantMembers: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        apiKeys: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: "key-1" }, { id: "key-2" }]),
        },
      },
    };

    await expect(
      assertUserQuota(db, "user-1", "apiKeys"),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("allows legacy workspaces without a tenant id", async () => {
    const db = {
      query: {
        workspaces: {
          findFirst: vi.fn().mockResolvedValue({ tenantId: null }),
        },
      },
    };

    await expect(
      assertWorkspaceQuota(db, "workspace-1", "monthlyTaskRuns"),
    ).resolves.toBeUndefined();
  });

  it("counts active task runs and agent runs against the active agent quota", async () => {
    const db = {
      query: {
        tenants: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: "tenant-1", plan: "free" }),
        },
        workspaces: {
          findMany: vi.fn().mockResolvedValue([{ id: "workspace-1" }]),
        },
        workItems: {
          findMany: vi.fn().mockResolvedValue([{ id: "work-item-1" }]),
        },
        chatConversations: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        taskRuns: {
          findMany: vi.fn().mockResolvedValue([{ id: "task-run-1" }]),
        },
        agentRuns: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
    };

    await expect(
      assertTenantQuota(db, "tenant-1", "activeAgents"),
    ).rejects.toMatchObject({
      quota: "activeAgents",
      limit: PLAN_QUOTAS.free.activeAgents,
    });
  });
});
