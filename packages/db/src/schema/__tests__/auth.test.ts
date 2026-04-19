import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import { users, sessions, accounts, verifications } from "../auth.js";

describe("@gmacko/db auth schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
    // Apply raw DDL — tests run per-table DDL from ../../client helpers
    // For Phase 6B, tables are created via drizzle-kit push in CI/dev; tests
    // use the SQL in src/migrate.ts or `drizzle.run()`
    await ctx.pglite.exec(DDL);
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

// Raw DDL — applied per-test because drizzle-kit push infrastructure comes later
// (Task 11). This block is replaced with applyTestMigrations() after Task 11.
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
CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  account_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX accounts_user_id_idx ON accounts(user_id);
CREATE INDEX verifications_identifier_idx ON verifications(identifier);
`;
