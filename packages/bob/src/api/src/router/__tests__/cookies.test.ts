import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptCookieValue

} from "../../services/crypto/cookieVault.js";
import type {EncryptedCookieValue} from "../../services/crypto/cookieVault.js";

const TEST_KEY = "test-cookie-encryption-key-32chs";

let appRouter: typeof import("../../root").appRouter;

// ── DB mock layer ──────────────────────────────────────────────────

/** In-memory store that the mock DB operates on */
let cookieRows: any[];
let scopeRows: any[];

const makeDbMock = () => ({
  query: {
    browserCookies: {
      findMany: vi.fn(({ where }: any) => {
        // Return all cookies for simplicity — caller filters in router
        return Promise.resolve(cookieRows);
      }),
    },
    sessionCookieScopes: {
      findFirst: vi.fn(({ where }: any) => {
        // Simplified: return first scope row if any exist
        return Promise.resolve(scopeRows.length > 0 ? scopeRows[0] : null);
      }),
    },
    chatConversations: {
      // setSessionScopes verifies the user owns the session before writing
      // scopes; tests use a fake user-1 owner so we always return a row.
      findFirst: vi.fn(() =>
        Promise.resolve({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      ),
    },
  },
  insert: vi.fn((table: any) => ({
    values: vi.fn((vals: any) => {
      const rows = Array.isArray(vals) ? vals : [vals];
      // Store rows depending on which table
      if (rows[0] && "valueCiphertext" in rows[0]) {
        cookieRows.push(...rows);
      } else if (rows[0] && "sessionId" in rows[0]) {
        scopeRows.push(...rows);
      }
      return {
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        onConflictDoNothing: vi.fn(() => Promise.resolve()),
        returning: vi.fn(() => Promise.resolve(rows)),
      };
    }),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        groupBy: vi.fn(() => Promise.resolve([])),
      })),
    })),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(() => {
        const deleted = [...cookieRows];
        cookieRows.length = 0;
        return Promise.resolve(deleted.map((r) => ({ id: r.id ?? "x" })));
      }),
    })),
  })),
});

const fakeSession = {
  session: {
    id: "auth-session-1",
    createdAt: new Date("2026-03-28T00:00:00.000Z"),
    updatedAt: new Date("2026-03-28T00:00:00.000Z"),
    userId: "user-1",
    expiresAt: new Date("2026-03-29T00:00:00.000Z"),
    token: "token-1",
    ipAddress: null,
    userAgent: null,
  },
  user: {
    id: "user-1",
    createdAt: new Date("2026-03-28T00:00:00.000Z"),
    updatedAt: new Date("2026-03-28T00:00:00.000Z"),
    email: "test@example.com",
    emailVerified: true,
    name: "Test User",
    image: null,
  },
};

const createApiKeyCaller = () =>
  appRouter.createCaller({
    session: fakeSession,
    authApi: { getSession: vi.fn() } as any,
    apiKeyAuth: { keyId: "test-key", permissions: ["admin"] as const, user: fakeSession.user, userId: fakeSession.user.id },
    db: makeDbMock() as any,
  });

const createProtectedCaller = () =>
  appRouter.createCaller({
    session: fakeSession,
    authApi: { getSession: vi.fn() } as any,
    apiKeyAuth: null,
    db: makeDbMock() as any,
  });

// ── Setup ──────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.GIT_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  process.env.DATABASE_URL ??=
    "postgres://postgres:postgres@localhost:5432/test";
  ({ appRouter } = await import("../../root"));
});

beforeEach(() => {
  cookieRows = [];
  scopeRows = [];
});

// ── Tests ──────────────────────────────────────────────────────────

describe("cookies router", () => {
  describe("import", () => {
    it("should encrypt and store cookies for a domain", async () => {
      const caller = createApiKeyCaller();

      const result = await caller.cookies.import({
        cookies: [
          {
            name: "session",
            value: "abc123",
            domain: ".github.com",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
          },
        ],
        source: "extension",
      });

      expect(result.imported).toBe(1);
      // Source intentionally normalizes domains (strips leading dot, lowercases)
      // via normalizeDomain() in cookies.ts. Test was previously asserting the
      // unnormalized form; updated to match production behavior.
      expect(result.domains).toEqual(["github.com"]);
    });

    it("should accept up to 500 cookies", async () => {
      const caller = createApiKeyCaller();
      const cookies = Array.from({ length: 500 }, (_, i) => ({
        name: `c${i}`,
        value: `v${i}`,
        domain: ".example.com",
      }));

      const result = await caller.cookies.import({
        cookies,
        source: "cli",
      });

      expect(result.imported).toBe(500);
    });

    it("should reject empty cookie array", async () => {
      const caller = createApiKeyCaller();

      await expect(
        caller.cookies.import({ cookies: [], source: "cli" }),
      ).rejects.toThrow();
    });

    it("should reject more than 500 cookies", async () => {
      const caller = createApiKeyCaller();
      const cookies = Array.from({ length: 501 }, (_, i) => ({
        name: `c${i}`,
        value: `v${i}`,
        domain: ".example.com",
      }));

      await expect(
        caller.cookies.import({ cookies, source: "cli" }),
      ).rejects.toThrow();
    });
  });

  describe("list", () => {
    it("should call the list procedure without error", async () => {
      const caller = createProtectedCaller();
      const result = await caller.cookies.list();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("remove", () => {
    it("should call remove and return deleted count", async () => {
      const caller = createProtectedCaller();

      // Seed a row so delete has something to return
      cookieRows.push({ id: "cookie-1", domain: ".github.com" });

      const result = await caller.cookies.remove({ domain: ".github.com" });
      expect(result).toHaveProperty("deleted");
      expect(typeof result.deleted).toBe("number");
    });
  });

  describe("getForSession", () => {
    it("should return error when domain is not in scope", async () => {
      const caller = createApiKeyCaller();

      // No scopes set — scopeRows is empty
      const result = await caller.cookies.getForSession({
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        domain: ".linear.app",
      });

      expect(result.cookies).toEqual([]);
      expect(result.error).toContain("not in scope");
    });

    it("should return decrypted cookies when domain is in scope", async () => {
      const caller = createApiKeyCaller();
      const cookieId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

      // Add a scope entry
      scopeRows.push({
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        domain: ".github.com",
      });

      // Encrypt a value and add to cookie store
      const { encryptCookieValue } = await import(
        "../../services/crypto/cookieVault.js"
      );
      const encrypted = encryptCookieValue("session-token-xyz", cookieId);

      cookieRows.push({
        id: cookieId,
        userId: "user-1",
        domain: ".github.com",
        name: "session",
        valueCiphertext: encrypted.ciphertext,
        valueIv: encrypted.iv,
        valueTag: encrypted.tag,
        path: "/",
        expires: null,
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      });

      const result = await caller.cookies.getForSession({
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        domain: ".github.com",
      });

      expect(result.cookies).toHaveLength(1);
      expect(result.cookies[0]!.name).toBe("session");
      expect(result.cookies[0]!.value).toBe("session-token-xyz");
      expect(result.cookies[0]!.domain).toBe(".github.com");
    });

    it("should filter out expired cookies", async () => {
      const caller = createApiKeyCaller();
      const cookieId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

      scopeRows.push({
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        domain: ".github.com",
      });

      const { encryptCookieValue } = await import(
        "../../services/crypto/cookieVault.js"
      );
      const encrypted = encryptCookieValue("expired-val", cookieId);

      cookieRows.push({
        id: cookieId,
        userId: "user-1",
        domain: ".github.com",
        name: "old-cookie",
        valueCiphertext: encrypted.ciphertext,
        valueIv: encrypted.iv,
        valueTag: encrypted.tag,
        path: "/",
        expires: new Date("2020-01-01T00:00:00.000Z"), // expired
        secure: false,
        httpOnly: false,
        sameSite: "Lax",
      });

      const result = await caller.cookies.getForSession({
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        domain: ".github.com",
      });

      expect(result.cookies).toHaveLength(0);
    });
  });

  describe("setSessionScopes", () => {
    it("should set scopes and return count", async () => {
      const caller = createProtectedCaller();

      const result = await caller.cookies.setSessionScopes({
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        domains: [".github.com", ".linear.app"],
      });

      expect(result.scoped).toBe(2);
    });

    it("should require at least one domain", async () => {
      const caller = createProtectedCaller();

      await expect(
        caller.cookies.setSessionScopes({
          sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          domains: [],
        }),
      ).rejects.toThrow();
    });
  });

  describe("auth enforcement", () => {
    it("should reject import without API key auth", async () => {
      const caller = appRouter.createCaller({
        session: fakeSession,
        authApi: { getSession: vi.fn() } as any,
        apiKeyAuth: null,
        db: makeDbMock() as any,
      });

      await expect(
        caller.cookies.import({
          cookies: [{ name: "a", value: "b", domain: ".x.com" }],
          source: "cli",
        }),
      ).rejects.toThrow(/API key/i);
    });

    it("should reject getForSession without API key auth", async () => {
      const caller = appRouter.createCaller({
        session: fakeSession,
        authApi: { getSession: vi.fn() } as any,
        apiKeyAuth: null,
        db: makeDbMock() as any,
      });

      await expect(
        caller.cookies.getForSession({
          sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          domain: ".github.com",
        }),
      ).rejects.toThrow(/API key/i);
    });
  });
});
