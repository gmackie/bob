import { describe, expect, it } from "vitest";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const HAS_DB = Boolean(DATABASE_URL);

describe.skipIf(!HAS_DB)("validateSessionToken", () => {
  let sql: ReturnType<typeof postgres>;

  it("returns userId + email for a valid non-expired session", async () => {
    sql = postgres(DATABASE_URL!, { max: 1 });

    // Seed a test user + session directly
    const userId = "test-user-auth-" + Date.now();
    const token = "test-token-" + Date.now();
    const email = "test@example.com";

    try {
      await sql`
        INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
        VALUES (${userId}, 'Test User', ${email}, true, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO sessions (id, user_id, token, expires_at, created_at, updated_at)
        VALUES (${"sess-" + Date.now()}, ${userId}, ${token}, NOW() + INTERVAL '1 hour', NOW(), NOW())
      `;

      const { validateSessionToken } = await import("../auth");
      const { db } = await import("../client");

      const result = await validateSessionToken(db, token);
      expect(result).toEqual({ userId, email });
    } finally {
      // Cleanup
      await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end({ timeout: 2 });
    }
  });

  it("throws for an expired session", async () => {
    sql = postgres(DATABASE_URL!, { max: 1 });

    const userId = "test-user-expired-" + Date.now();
    const token = "expired-token-" + Date.now();

    try {
      await sql`
        INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
        VALUES (${userId}, 'Expired User', 'expired@example.com', true, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO sessions (id, user_id, token, expires_at, created_at, updated_at)
        VALUES (${"sess-exp-" + Date.now()}, ${userId}, ${token}, NOW() - INTERVAL '1 hour', NOW(), NOW())
      `;

      const { validateSessionToken } = await import("../auth");
      const { db } = await import("../client");

      await expect(validateSessionToken(db, token)).rejects.toThrow();
    } finally {
      await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end({ timeout: 2 });
    }
  });

  it("throws for a missing token", async () => {
    const { validateSessionToken } = await import("../auth");
    const { db } = await import("../client");

    await expect(
      validateSessionToken(db, "nonexistent-token-" + Date.now()),
    ).rejects.toThrow();
  });
});

describe("extractSessionToken", () => {
  it("extracts token from Authorization: Bearer header", async () => {
    const { extractSessionToken } = await import("../auth");
    const headers = new Headers({ authorization: "Bearer my-token-123" });
    expect(extractSessionToken(headers)).toBe("my-token-123");
  });

  it("extracts token from better-auth.session_token cookie", async () => {
    const { extractSessionToken } = await import("../auth");
    const headers = new Headers({
      cookie: "other=abc; better-auth.session_token=my-session-token; foo=bar",
    });
    expect(extractSessionToken(headers)).toBe("my-session-token");
  });

  it("extracts token from session cookie", async () => {
    const { extractSessionToken } = await import("../auth");
    const headers = new Headers({
      cookie: "session=fallback-token",
    });
    expect(extractSessionToken(headers)).toBe("fallback-token");
  });

  it("prefers Bearer header over cookie", async () => {
    const { extractSessionToken } = await import("../auth");
    const headers = new Headers({
      authorization: "Bearer bearer-token",
      cookie: "better-auth.session_token=cookie-token",
    });
    expect(extractSessionToken(headers)).toBe("bearer-token");
  });

  it("returns null when no token is present", async () => {
    const { extractSessionToken } = await import("../auth");
    const headers = new Headers({ "content-type": "application/json" });
    expect(extractSessionToken(headers)).toBeNull();
  });

  it("returns null for empty Bearer value", async () => {
    const { extractSessionToken } = await import("../auth");
    const headers = new Headers({ authorization: "Bearer " });
    expect(extractSessionToken(headers)).toBeNull();
  });
});
