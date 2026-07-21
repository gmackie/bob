import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { sessionCookieScopes as mockSessionCookieScopes } from "@bob/db/schema";
import type { createTRPCContext } from "../../trpc.js";

const TEST_KEY = "test-cookie-encryption-key-32chs";

let appRouter: typeof import("../../root").appRouter;

// The real tRPC context type — test callers below construct a structurally
// close-enough fake (mock db/authApi) and cast through `unknown` rather than
// `any`, since the mocks intentionally don't implement the full Db/AuthApi
// surface, only what these handlers actually call.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

// ── DB mock layer ──────────────────────────────────────────────────

// Only `id` and `domain` are required — the `remove` test seeds a bare
// { id, domain } row (delete only ever reads r.id back), while the
// getForSession tests seed fully-populated rows.
interface CookieRow {
  id: string;
  userId?: string;
  domain: string;
  name?: string;
  valueCiphertext?: string;
  valueIv?: string;
  valueTag?: string;
  path?: string;
  expires?: Date | null;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}

interface ScopeRow {
  sessionId: string;
  domain: string;
}

type InsertValues = Record<string, unknown>;

/** In-memory store that the mock DB operates on */
let cookieRows: CookieRow[];
let scopeRows: ScopeRow[];

const makeDbMock = () => ({
  query: {
    chatConversations: {
      // setSessionScopes verifies the user owns the session before writing
      // scopes; tests use a fake user-1 owner so we always return a row.
      findFirst: vi.fn(() =>
        Promise.resolve({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      ),
    },
  },
  insert: vi.fn((_table: unknown) => ({
    values: vi.fn((vals: InsertValues | InsertValues[]) => {
      const rows = Array.isArray(vals) ? vals : [vals];
      // Store rows depending on which table
      if (rows[0] && "valueCiphertext" in rows[0]) {
        cookieRows.push(...(rows as unknown as CookieRow[]));
      } else if (rows[0] && "sessionId" in rows[0]) {
        scopeRows.push(...(rows as unknown as ScopeRow[]));
      }
      return {
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        onConflictDoNothing: vi.fn(() => Promise.resolve()),
        returning: vi.fn(() => Promise.resolve(rows)),
      };
    }),
  })),
  // select() covers three shapes used by the handlers:
  //  - cookiesList: .select({...}).from(browserCookies).where(...).groupBy(...)
  //  - getForSession scope check: .select().from(sessionCookieScopes).where(...).limit(1)
  //  - getForSession cookie read: .select().from(browserCookies).where(...) (awaited directly)
  // Tag behavior by which table object .from() receives — these are the real
  // drizzle table objects (no @bob/db/schema mock; the handler's own module
  // imports resolve normally), so identity comparison against the imported
  // sessionCookieScopes table is reliable.
  select: vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === mockSessionCookieScopes) {
        const rows = scopeRows;
        return {
          where: vi.fn(() => ({
            limit: vi.fn((n: number) => Promise.resolve(rows.slice(0, n))),
          })),
        };
      }
      // browserCookies (or any other table): return cookieRows, support
      // both .groupBy() (cookiesList) and direct await (getForSession).
      const rows = [...cookieRows];
      return {
        where: vi.fn(() => ({
          groupBy: vi.fn(() => Promise.resolve([])),
          then: (resolve: (rows: CookieRow[]) => void) => resolve(rows),
        })),
      };
    }),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => ({
      returning: vi.fn(() => {
        const deleted = [...cookieRows];
        cookieRows.length = 0;
        return Promise.resolve(deleted.map((r) => ({ id: r.id })));
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
    authApi: { getSession: vi.fn() },
    apiKeyAuth: { keyId: "test-key", permissions: ["admin"] as const, user: fakeSession.user, userId: fakeSession.user.id },
    db: makeDbMock(),
  } as unknown as TRPCContext);

const createProtectedCaller = () =>
  appRouter.createCaller({
    session: fakeSession,
    authApi: { getSession: vi.fn() },
    apiKeyAuth: null,
    db: makeDbMock(),
  } as unknown as TRPCContext);

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
  }, 60_000);

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
      const [cookie] = result.cookies;
      expect(cookie?.name).toBe("session");
      expect(cookie?.value).toBe("session-token-xyz");
      expect(cookie?.domain).toBe(".github.com");
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
      const caller = createProtectedCaller();

      await expect(
        caller.cookies.import({
          cookies: [{ name: "a", value: "b", domain: ".x.com" }],
          source: "cli",
        }),
      ).rejects.toThrow(/API key/i);
    });

    it("should reject getForSession without API key auth", async () => {
      const caller = createProtectedCaller();

      await expect(
        caller.cookies.getForSession({
          sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          domain: ".github.com",
        }),
      ).rejects.toThrow(/API key/i);
    });
  });
});
