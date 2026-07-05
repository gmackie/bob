import { describe, expect, it } from "vitest";

import type { Db } from "@bob/db/client";

import {
  ensureUserMembershipForOwnedWorkspaces,
  workspaceCreate,
} from "../workspace";
import type { HandlerContext } from "../context";

/**
 * Regression: workspaceCreate MUST attach a tenant to the new workspace.
 *
 * agent_runs.tenant_id is NOT NULL and the ws-gateway only records a run when
 * the workspace has a tenant. A tenant-less workspace silently drops every
 * agent run, which is why daemon runs never appeared on the dashboard for
 * UI-created workspaces (e.g. hetzner-bob).
 */

type InsertValues = Record<string, unknown>;

interface Insert {
  table: string;
  values: InsertValues;
}

/** Minimal chainable mock of the drizzle db used by workspaceCreate. */
function makeDb(opts: { existingTenantId?: string | null } = {}) {
  const inserts: Insert[] = [];

  const insert = (_table: unknown) => {
    // drizzle pgTable objects expose their SQL name on a symbol; tests can't
    // read that reliably, so infer the table by insert order + shape instead.
    const record: Insert = { table: "", values: {} };
    inserts.push(record);
    const chain = {
      values(v: InsertValues) {
        record.values = v;
        // Tag table by the shape of the values for assertion convenience.
        if ("slug" in v && "plan" in v) record.table = "tenants";
        else if ("tenantId" in v && "role" in v && !("workspaceId" in v))
          record.table = "tenantMembers";
        else if ("ownerUserId" in v && "slug" in v) record.table = "workspaces";
        else if ("workspaceId" in v && "role" in v)
          record.table = "workspaceMembers";
        return chain;
      },
      onConflictDoNothing() {
        return chain;
      },
      returning() {
        if (record.table === "tenants")
          return Promise.resolve([{ id: "tenant-new" }]);
        if (record.table === "workspaces")
          return Promise.resolve([{ id: "ws-1", ...record.values }]);
        return Promise.resolve([{ id: `${record.table}-1`, ...record.values }]);
      },
    };
    return chain;
  };

  const db = {
    query: {
      tenantMembers: {
        findFirst() {
          return Promise.resolve(
            opts.existingTenantId
              ? { tenantId: opts.existingTenantId }
              : undefined,
          );
        },
      },
    },
    insert,
    __inserts: inserts,
  };

  return db;
}

describe("workspaceCreate", () => {
  it("creates a tenant and attaches it to the new workspace when the user has none", async () => {
    const db = makeDb({ existingTenantId: null });
    const ctx: HandlerContext = { db, userId: "user-abc" } as unknown as HandlerContext;

    const ws = await workspaceCreate(ctx, { name: "Hetzner Bob", slug: "hetzner-bob" });

    expect(ws.tenantId).toBe("tenant-new");

    const wsInsert = db.__inserts.find((i) => i.table === "workspaces");
    expect(wsInsert?.values.tenantId).toBe("tenant-new");
    // Tenant + membership were created.
    expect(db.__inserts.some((i) => i.table === "tenants")).toBe(true);
  });

  it("reuses the user's existing tenant", async () => {
    const db = makeDb({ existingTenantId: "tenant-existing" });
    const ctx: HandlerContext = { db, userId: "user-abc" } as unknown as HandlerContext;

    const ws = await workspaceCreate(ctx, { name: "W", slug: "w" });

    expect(ws.tenantId).toBe("tenant-existing");
    // No new tenant row should be inserted when one already exists.
    expect(db.__inserts.some((i) => i.table === "tenants")).toBe(false);
  });
});

function makeBypassMembershipDb(opts: {
  existingTenantMember?: boolean;
  existingWorkspaceMember?: boolean;
  workspaceTenantId?: string | null;
}) {
  const inserts: Insert[] = [];
  const updates: Insert[] = [];

  const db = {
    query: {
      workspaces: {
        findMany() {
          return Promise.resolve([
            {
              id: "workspace-owned",
              ownerUserId: "default-user",
              tenantId:
                "workspaceTenantId" in opts
                  ? opts.workspaceTenantId
                  : "tenant-prod",
            },
          ]);
        },
      },
      tenantMembers: {
        findFirst() {
          if (opts.workspaceTenantId === null)
            return Promise.resolve({ tenantId: "tenant-new" });
          return Promise.resolve(
            opts.existingTenantMember ? { id: "tenant-member-1" } : null,
          );
        },
      },
      workspaceMembers: {
        findFirst() {
          return Promise.resolve(
            opts.existingWorkspaceMember ? { id: "workspace-member-1" } : null,
          );
        },
      },
    },
    insert(_table: unknown) {
      const record: Insert = { table: "", values: {} };
      inserts.push(record);
      return {
        values(v: InsertValues) {
          record.values = v;
          if ("tenantId" in v && "role" in v && !("workspaceId" in v))
            record.table = "tenantMembers";
          else if ("workspaceId" in v && "role" in v)
            record.table = "workspaceMembers";
          return {
            returning() {
              return Promise.resolve([{ id: `${record.table}-new`, ...v }]);
            },
          };
        },
      };
    },
    update(_table: unknown) {
      const record: Insert = { table: "workspaces", values: {} };
      updates.push(record);
      return {
        set(v: InsertValues) {
          record.values = v;
          return {
            where() {
              return {
                returning() {
                  return Promise.resolve([{ id: "workspace-owned", ...v }]);
                },
              };
            },
          };
        },
      };
    },
    __inserts: inserts,
    __updates: updates,
  };

  return db;
}

describe("ensureUserMembershipForOwnedWorkspaces", () => {
  it("adds tenant and workspace membership for the bypass user's owned workspace", async () => {
    const db = makeBypassMembershipDb({});

    await ensureUserMembershipForOwnedWorkspaces(db as unknown as Db, "default-user");

    expect(db.__inserts).toEqual([
      {
        table: "tenantMembers",
        values: {
          tenantId: "tenant-prod",
          userId: "default-user",
          role: "member",
        },
      },
      {
        table: "workspaceMembers",
        values: {
          workspaceId: "workspace-owned",
          userId: "default-user",
          role: "owner",
        },
      },
    ]);
  });

  it("does not duplicate existing bypass user memberships", async () => {
    const db = makeBypassMembershipDb({
      existingTenantMember: true,
      existingWorkspaceMember: true,
    });

    await ensureUserMembershipForOwnedWorkspaces(db as unknown as Db, "default-user");

    expect(db.__inserts).toEqual([]);
  });

  it("attaches tenantless owned workspaces to the bypass user's tenant", async () => {
    const db = makeBypassMembershipDb({ workspaceTenantId: null });

    await ensureUserMembershipForOwnedWorkspaces(db as unknown as Db, "default-user");

    expect(db.__updates).toEqual([
      {
        table: "workspaces",
        values: {
          tenantId: "tenant-new",
        },
      },
    ]);
    expect(db.__inserts).toContainEqual({
      table: "workspaceMembers",
      values: {
        workspaceId: "workspace-owned",
        userId: "default-user",
        role: "owner",
      },
    });
  });
});
