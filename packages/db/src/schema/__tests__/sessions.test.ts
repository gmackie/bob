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
    // Apply raw DDL — per-test until Task 11 wires drizzle-kit migrations
    // into the shared helper. DDL includes prerequisites (users, tenants,
    // tenant_members) because the session tables reference tenants and
    // users. The session_status + chat_message_role pgEnums are declared
    // here as well.
    await ctx.pglite.exec(DDL);
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

// Raw DDL — applied per-test because drizzle-kit push infrastructure comes
// later (Task 11). This block is replaced with applyTestMigrations() after
// Task 11. Includes users + tenants + tenant_members because the session
// tables reference tenants (uuid) and users (text). Declares both the
// session_status and chat_message_role pgEnums; chat_message_role is
// distinct from the OODA-adjacent `message_role` used by the legacy
// messages.ts table so the two enums never collide.
const DDL = `
CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TYPE tenant_role AS ENUM ('owner', 'admin', 'member');
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(128) NOT NULL,
  slug varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role tenant_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_members_tenant_user_unique UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_members_tenant_id_idx ON tenant_members(tenant_id);
CREATE INDEX tenant_members_user_id_idx ON tenant_members(user_id);
CREATE TYPE session_status AS ENUM ('pending', 'active', 'completed', 'failed', 'canceled');
CREATE TYPE chat_message_role AS ENUM ('user', 'assistant', 'system', 'tool');
CREATE TABLE chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(256),
  adapter_id varchar(64) NOT NULL,
  status session_status NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_conversations_tenant_id_idx ON chat_conversations(tenant_id);
CREATE INDEX chat_conversations_user_id_idx ON chat_conversations(user_id);
CREATE INDEX chat_conversations_status_idx ON chat_conversations(status);
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  role chat_message_role NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_conversation_seq_unique UNIQUE (conversation_id, seq)
);
CREATE INDEX chat_messages_conversation_id_idx ON chat_messages(conversation_id);
`;
