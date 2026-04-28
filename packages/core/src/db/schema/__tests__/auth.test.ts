import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import { users, sessions, accounts, verifications } from "../auth.js";

describe("@gmacko/db auth schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it("users: insert + query by id + query by email", async () => {
    const user: typeof users.$inferInsert = {
      id: "user_test_1",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: false,
    };
    await ctx.db.insert(users).values(user);

    const byId = await ctx.db.query.users.findFirst({
      where: eq(users.id, "user_test_1"),
    });
    expect(byId?.email).toBe("alice@example.com");

    const byEmail = await ctx.db.query.users.findFirst({
      where: eq(users.email, "alice@example.com"),
    });
    expect(byEmail?.id).toBe("user_test_1");
  });

  it("sessions: insert + cascade on user delete", async () => {
    await ctx.db.insert(users).values({
      id: "user_cascade",
      name: "Bob",
      email: "bob@example.com",
      emailVerified: false,
    });
    await ctx.db.insert(sessions).values({
      id: "sess_1",
      userId: "user_cascade",
      token: "tok_1",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // Delete user — session should cascade
    await ctx.db.delete(users).where(eq(users.id, "user_cascade"));
    const remaining = await ctx.db.query.sessions.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("accounts: insert with oauth provider fields", async () => {
    await ctx.db.insert(users).values({
      id: "user_oauth",
      name: "Carol",
      email: "carol@example.com",
      emailVerified: true,
    });
    await ctx.db.insert(accounts).values({
      id: "acct_1",
      userId: "user_oauth",
      providerId: "github",
      accountId: "gh_12345",
      accessToken: "ghp_xxx",
    });

    const acct = await ctx.db.query.accounts.findFirst({
      where: eq(accounts.id, "acct_1"),
    });
    expect(acct?.providerId).toBe("github");
    expect(acct?.accountId).toBe("gh_12345");
  });

  it("verifications: insert + query by identifier", async () => {
    await ctx.db.insert(verifications).values({
      id: "ver_1",
      identifier: "email:alice@example.com",
      value: "random-code-123",
      expiresAt: new Date(Date.now() + 600_000),
    });
    const v = await ctx.db.query.verifications.findFirst({
      where: eq(verifications.identifier, "email:alice@example.com"),
    });
    expect(v?.value).toBe("random-code-123");
  });
});

