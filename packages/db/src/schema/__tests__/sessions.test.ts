import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import { chatConversations, chatMessages } from "../sessions.js";
import { tenants } from "../tenancy.js";
import { users } from "../auth.js";

describe("@gmacko/db sessions schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it("chat_conversations: insert + query by id; default status is pending", async () => {
    await ctx.db.insert(users).values({
      id: "user_sess_1",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: false,
    });
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Acme", slug: "acme" })
      .returning();

    const [conv] = await ctx.db
      .insert(chatConversations)
      .values({
        tenantId: tenant!.id,
        userId: "user_sess_1",
        title: "Plan the week",
        adapterId: "claude",
      })
      .returning();

    const found = await ctx.db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, conv!.id),
    });
    expect(found).toBeDefined();
    expect(found?.tenantId).toBe(tenant!.id);
    expect(found?.userId).toBe("user_sess_1");
    expect(found?.adapterId).toBe("claude");
    expect(found?.title).toBe("Plan the week");
    expect(found?.status).toBe("pending");
    expect(found?.metadata).toEqual({});
  });

  it("chat_messages: insert ordered rows (seq 1, 2, 3) and read back in order", async () => {
    await ctx.db.insert(users).values({
      id: "user_msg_order",
      name: "Bob",
      email: "bob@example.com",
      emailVerified: false,
    });
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Order Co", slug: "order" })
      .returning();
    const [conv] = await ctx.db
      .insert(chatConversations)
      .values({
        tenantId: tenant!.id,
        userId: "user_msg_order",
        adapterId: "claude",
      })
      .returning();

    await ctx.db.insert(chatMessages).values([
      {
        conversationId: conv!.id,
        seq: 1,
        role: "user",
        content: "Hello",
      },
      {
        conversationId: conv!.id,
        seq: 2,
        role: "assistant",
        content: "Hi there",
      },
      {
        conversationId: conv!.id,
        seq: 3,
        role: "tool",
        content: "",
        metadata: { toolName: "search", args: { q: "weather" } },
      },
    ]);

    const rows = await ctx.db.query.chatMessages.findMany({
      where: eq(chatMessages.conversationId, conv!.id),
      orderBy: [asc(chatMessages.seq)],
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "tool"]);
    expect(rows[0]?.content).toBe("Hello");
    expect(rows[2]?.content).toBe("");
    expect(rows[2]?.metadata).toEqual({
      toolName: "search",
      args: { q: "weather" },
    });
  });

  it("chat_messages: cascade on conversation delete", async () => {
    await ctx.db.insert(users).values({
      id: "user_cascade",
      name: "Carol",
      email: "carol@example.com",
      emailVerified: false,
    });
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Cascade LLC", slug: "cascade" })
      .returning();
    const [conv] = await ctx.db
      .insert(chatConversations)
      .values({
        tenantId: tenant!.id,
        userId: "user_cascade",
        adapterId: "codex",
      })
      .returning();

    await ctx.db.insert(chatMessages).values([
      { conversationId: conv!.id, seq: 1, role: "user", content: "Ping" },
      {
        conversationId: conv!.id,
        seq: 2,
        role: "assistant",
        content: "Pong",
      },
    ]);

    await ctx.db
      .delete(chatConversations)
      .where(eq(chatConversations.id, conv!.id));

    const remaining = await ctx.db.query.chatMessages.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("chat_messages: (conversationId, seq) uniqueness enforced", async () => {
    await ctx.db.insert(users).values({
      id: "user_dup_seq",
      name: "Dana",
      email: "dana@example.com",
      emailVerified: false,
    });
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Dup Inc", slug: "dup-seq" })
      .returning();
    const [conv] = await ctx.db
      .insert(chatConversations)
      .values({
        tenantId: tenant!.id,
        userId: "user_dup_seq",
        adapterId: "claude",
      })
      .returning();

    await ctx.db.insert(chatMessages).values({
      conversationId: conv!.id,
      seq: 1,
      role: "user",
      content: "first",
    });

    await expect(
      ctx.db.insert(chatMessages).values({
        conversationId: conv!.id,
        seq: 1,
        role: "assistant",
        content: "collision",
      }),
    ).rejects.toThrow();
  });

  it("chat_conversations: status transitions from pending to active", async () => {
    await ctx.db.insert(users).values({
      id: "user_status",
      name: "Eve",
      email: "eve@example.com",
      emailVerified: false,
    });
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Status Co", slug: "status" })
      .returning();
    const [conv] = await ctx.db
      .insert(chatConversations)
      .values({
        tenantId: tenant!.id,
        userId: "user_status",
        adapterId: "claude",
      })
      .returning();

    expect(conv?.status).toBe("pending");

    await ctx.db
      .update(chatConversations)
      .set({ status: "active" })
      .where(eq(chatConversations.id, conv!.id));

    const updated = await ctx.db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, conv!.id),
    });
    expect(updated?.status).toBe("active");
  });
});

