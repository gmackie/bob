import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./helpers.js";
import {
  users,
  tenants,
  tenantMembers,
  chatConversations,
} from "../schema/index.js";

// Smoke test proving the 6B schema graph is cohesive end-to-end:
//   users  ->  tenant_members  ->  tenants  ->  chat_conversations
// If any assertion here fails, the 6B schema has a regression and
// 6C auth wiring must stop until it's fixed.

describe("@gmacko/db cross-schema JOIN smoke", () => {
  it("traverses users -> tenant_members -> tenants -> chat_conversations with inner joins", async () => {
    const ctx = await createTestDb();
    try {
      const userId = "u_" + crypto.randomUUID();
      await ctx.db.insert(users).values({
        id: userId,
        name: "Alice Owner",
        email: "alice.owner@example.com",
      });

      const [tenant] = await ctx.db
        .insert(tenants)
        .values({ name: "Acme Labs", slug: "acme-labs" })
        .returning();

      await ctx.db.insert(tenantMembers).values({
        tenantId: tenant!.id,
        userId,
        role: "owner",
      });

      const [conv] = await ctx.db
        .insert(chatConversations)
        .values({
          tenantId: tenant!.id,
          userId,
          adapterId: "claude",
        })
        .returning();

      const rows = await ctx.db
        .select({
          conversation: chatConversations,
          member: tenantMembers,
          tenant: tenants,
          user: users,
        })
        .from(chatConversations)
        .innerJoin(
          tenantMembers,
          and(
            eq(tenantMembers.tenantId, chatConversations.tenantId),
            eq(tenantMembers.userId, chatConversations.userId),
          ),
        )
        .innerJoin(tenants, eq(tenants.id, chatConversations.tenantId))
        .innerJoin(users, eq(users.id, chatConversations.userId));

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.conversation.id).toBe(conv!.id);
      expect(row.member.role).toBe("owner");
      expect(row.tenant.slug).toBe("acme-labs");
      expect(row.user.email).toBe("alice.owner@example.com");
    } finally {
      await ctx.teardown();
    }
  });

  it("cascades on tenant delete: conversation and member rows go, user remains", async () => {
    const ctx = await createTestDb();
    try {
      const userId = "u_" + crypto.randomUUID();
      await ctx.db.insert(users).values({
        id: userId,
        name: "Bob Cascade",
        email: "bob.cascade@example.com",
      });

      const [tenant] = await ctx.db
        .insert(tenants)
        .values({ name: "Cascade Co", slug: "cascade-tenant" })
        .returning();

      await ctx.db.insert(tenantMembers).values({
        tenantId: tenant!.id,
        userId,
        role: "admin",
      });

      await ctx.db.insert(chatConversations).values({
        tenantId: tenant!.id,
        userId,
        adapterId: "claude",
      });

      await ctx.db.delete(tenants).where(eq(tenants.id, tenant!.id));

      const convs = await ctx.db.query.chatConversations.findMany();
      const members = await ctx.db.query.tenantMembers.findMany();
      const remainingUsers = await ctx.db.query.users.findMany();

      expect(convs).toHaveLength(0);
      expect(members).toHaveLength(0);
      expect(remainingUsers).toHaveLength(1);
      expect(remainingUsers[0]?.id).toBe(userId);
    } finally {
      await ctx.teardown();
    }
  });

  it("cascades on user delete: conversation and member rows go, tenant remains", async () => {
    const ctx = await createTestDb();
    try {
      const userId = "u_" + crypto.randomUUID();
      await ctx.db.insert(users).values({
        id: userId,
        name: "Carol User-Cascade",
        email: "carol.usercascade@example.com",
      });

      const [tenant] = await ctx.db
        .insert(tenants)
        .values({ name: "User Cascade Co", slug: "user-cascade-tenant" })
        .returning();

      await ctx.db.insert(tenantMembers).values({
        tenantId: tenant!.id,
        userId,
        role: "member",
      });

      await ctx.db.insert(chatConversations).values({
        tenantId: tenant!.id,
        userId,
        adapterId: "claude",
      });

      await ctx.db.delete(users).where(eq(users.id, userId));

      const convs = await ctx.db.query.chatConversations.findMany();
      const members = await ctx.db.query.tenantMembers.findMany();
      const remainingTenants = await ctx.db.query.tenants.findMany();

      expect(convs).toHaveLength(0);
      expect(members).toHaveLength(0);
      expect(remainingTenants).toHaveLength(1);
      expect(remainingTenants[0]?.id).toBe(tenant!.id);
    } finally {
      await ctx.teardown();
    }
  });
});
