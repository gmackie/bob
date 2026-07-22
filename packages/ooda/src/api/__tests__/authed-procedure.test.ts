// Unit tests for OODA's tRPC `authedProcedure` programmatic-auth path.
//
// The procedure reads a module-singleton `db` (`@gmacko/ooda/db/client`) and
// the shared `validateApiKey`; both are mocked here so we can exercise the
// procedure's OWN logic — credential extraction (x-api-key vs Bearer),
// cookie-first precedence, ctx shaping, and the no-bypass 401 — without a live
// Postgres. The validator itself is proven against real Postgres in
// `@gmacko/core`'s validate-api-key.test.ts.
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeyValidationResult } from "@gmacko/core/auth/validate-api-key";

const validateApiKeyMock =
  vi.fn<(...args: unknown[]) => Promise<ApiKeyValidationResult>>();

vi.mock("@gmacko/ooda/db/client", () => ({ db: { __marker: "ooda-db" } }));
vi.mock("@gmacko/core/auth/validate-api-key", () => ({
  validateApiKey: (...args: unknown[]) => validateApiKeyMock(...args),
}));

// Imported after the mocks are registered.
const { createTRPCRouter, authedProcedure, createTRPCContext } = await import(
  "../trpc.js"
);

// A minimal router exposing the authed ctx so tests can assert what the
// middleware populated.
const router = createTRPCRouter({
  whoami: authedProcedure.query(({ ctx }) => ({
    userId: ctx.userId,
    email: ctx.email,
    sessionUserId: ctx.session.user.id,
  })),
});

function makeCaller(opts: {
  headers?: Record<string, string>;
  session?: { user: { id: string; email: string } } | null;
}) {
  const headers = new Headers(opts.headers ?? {});
  const auth = {
    api: { getSession: async () => opts.session ?? null },
  } as never;
  const ctx = { db: { __marker: "ooda-db" }, headers, auth } as unknown as Awaited<
    ReturnType<typeof createTRPCContext>
  >;
  return router.createCaller(ctx);
}

const VALID: ApiKeyValidationResult = {
  ok: true,
  value: {
    keyId: "key_1",
    userId: "user_abc",
    email: "svc@example.com",
    permissions: ["read"],
  },
};

beforeEach(() => {
  validateApiKeyMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authedProcedure — cookie path (unchanged)", () => {
  it("authenticates a valid better-auth session and never checks a key", async () => {
    const caller = makeCaller({
      session: { user: { id: "cookie_user", email: "cookie@example.com" } },
    });
    const res = await caller.whoami();
    expect(res).toEqual({
      userId: "cookie_user",
      email: "cookie@example.com",
      sessionUserId: "cookie_user",
    });
    expect(validateApiKeyMock).not.toHaveBeenCalled();
  });
});

describe("authedProcedure — API key path", () => {
  it("authenticates a valid key via x-api-key", async () => {
    validateApiKeyMock.mockResolvedValue(VALID);
    const caller = makeCaller({
      session: null,
      headers: { "x-api-key": "bob_validkey" },
    });
    const res = await caller.whoami();
    expect(res).toEqual({
      userId: "user_abc",
      email: "svc@example.com",
      sessionUserId: "user_abc",
    });
    expect(validateApiKeyMock).toHaveBeenCalledWith(
      { __marker: "ooda-db" },
      "bob_validkey",
    );
  });

  it("authenticates a valid key via Authorization: Bearer", async () => {
    validateApiKeyMock.mockResolvedValue(VALID);
    const caller = makeCaller({
      session: null,
      headers: { authorization: "Bearer bob_validkey" },
    });
    const res = await caller.whoami();
    expect(res.userId).toBe("user_abc");
    expect(validateApiKeyMock).toHaveBeenCalledWith(
      { __marker: "ooda-db" },
      "bob_validkey",
    );
  });

  it("prefers the cookie session over a key when both are present", async () => {
    validateApiKeyMock.mockResolvedValue(VALID);
    const caller = makeCaller({
      session: { user: { id: "cookie_user", email: "cookie@example.com" } },
      headers: { "x-api-key": "bob_validkey" },
    });
    const res = await caller.whoami();
    expect(res.userId).toBe("cookie_user");
    expect(validateApiKeyMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown key (validator not-found) with 401", async () => {
    validateApiKeyMock.mockResolvedValue({ ok: false, reason: "not-found" });
    const caller = makeCaller({
      session: null,
      headers: { "x-api-key": "bob_unknown" },
    });
    await expect(caller.whoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    } satisfies Partial<TRPCError>);
  });

  it("rejects a revoked key with 401", async () => {
    validateApiKeyMock.mockResolvedValue({ ok: false, reason: "revoked" });
    const caller = makeCaller({
      session: null,
      headers: { authorization: "Bearer bob_revoked" },
    });
    await expect(caller.whoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects an expired key with 401", async () => {
    validateApiKeyMock.mockResolvedValue({ ok: false, reason: "expired" });
    const caller = makeCaller({
      session: null,
      headers: { "x-api-key": "bob_expired" },
    });
    await expect(caller.whoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects when no credential is present and never calls the validator", async () => {
    const caller = makeCaller({ session: null });
    await expect(caller.whoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(validateApiKeyMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed/non-prefixed value (validator returns not-an-api-key) with 401", async () => {
    validateApiKeyMock.mockResolvedValue({
      ok: false,
      reason: "not-an-api-key",
    });
    const caller = makeCaller({
      session: null,
      headers: { "x-api-key": "garbage" },
    });
    await expect(caller.whoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
