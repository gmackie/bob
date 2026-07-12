import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the db module BEFORE importing auth
vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      session: {
        findFirst: vi.fn(),
      },
      apiKeys: {
        findFirst: vi.fn(),
      },
      workspaces: {
        findFirst: vi.fn(),
      },
    },
  },
}));

import { db } from "@bob/db/client";
import {
  assertNoAuthBypassInProduction,
  validateBrowserToken,
  validateDaemonAuth,
  validateInternalBearer,
} from "./auth.js";

describe("validateBrowserToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BOB_AUTH_BYPASS;
    delete process.env.BOB_AUTH_BYPASS_TOKEN;
    delete process.env.BOB_AUTH_BYPASS_USER_ID;
    delete process.env.REQUIRE_AUTH;
  });

  afterEach(() => {
    delete process.env.BOB_AUTH_BYPASS;
    delete process.env.BOB_AUTH_BYPASS_TOKEN;
    delete process.env.BOB_AUTH_BYPASS_USER_ID;
    delete process.env.REQUIRE_AUTH;
  });

  it("accepts the default auth bypass user only when auth bypass and token are configured", async () => {
    process.env.BOB_AUTH_BYPASS = "true";
    process.env.BOB_AUTH_BYPASS_TOKEN = "prod-secret";

    const result = await validateBrowserToken("bob-auth-bypass:prod-secret");

    expect(result).toBe("default-user");
    expect(db.query.session.findFirst).not.toHaveBeenCalled();
  });

  it("maps a valid auth bypass token to a configured user", async () => {
    process.env.BOB_AUTH_BYPASS = "true";
    process.env.BOB_AUTH_BYPASS_TOKEN = "prod-secret";
    process.env.BOB_AUTH_BYPASS_USER_ID = "user-123";

    const result = await validateBrowserToken("bob-auth-bypass:prod-secret");

    expect(result).toBe("user-123");
    expect(db.query.session.findFirst).not.toHaveBeenCalled();
  });

  it("rejects auth bypass tokens that do not match the configured secret", async () => {
    process.env.BOB_AUTH_BYPASS = "true";
    process.env.BOB_AUTH_BYPASS_TOKEN = "prod-secret";
    process.env.BOB_AUTH_BYPASS_USER_ID = "user-123";

    const result = await validateBrowserToken("bob-auth-bypass:wrong-secret");

    expect(result).toBeNull();
    expect(db.query.session.findFirst).not.toHaveBeenCalled();
  });

  it("rejects auth bypass tokens when no backend secret is configured", async () => {
    process.env.BOB_AUTH_BYPASS = "true";

    const result = await validateBrowserToken("bob-auth-bypass:prod-secret");

    expect(result).toBeNull();
    expect(db.query.session.findFirst).not.toHaveBeenCalled();
  });

  it("accepts the auth bypass token when normal auth is required", async () => {
    process.env.BOB_AUTH_BYPASS = "true";
    process.env.BOB_AUTH_BYPASS_TOKEN = "prod-secret";
    process.env.REQUIRE_AUTH = "true";

    const result = await validateBrowserToken("bob-auth-bypass:prod-secret");

    expect(result).toBe("default-user");
  });

  it("returns userId when the Better Auth cookie header contains a signed session token", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    (db.query.session.findFirst as any).mockResolvedValueOnce({
      id: "sess-1",
      token: "session-token",
      userId: "user-cookie",
      expiresAt: future,
    });

    const result = await validateBrowserToken(
      "better-auth.session_token=session-token.signature; other=value",
    );

    expect(result).toBe("user-cookie");
  });

  it("accepts the secure Better Auth cookie name", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    (db.query.session.findFirst as any).mockResolvedValueOnce({
      id: "sess-1",
      token: "secure-token",
      userId: "user-secure",
      expiresAt: future,
    });

    const result = await validateBrowserToken(
      "__Secure-better-auth.session_token=secure-token.signature",
    );

    expect(result).toBe("user-secure");
  });

  it("returns userId when session token is valid and not expired", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    (db.query.session.findFirst as any).mockResolvedValueOnce({
      id: "sess-1",
      token: "good-token",
      userId: "user-abc",
      expiresAt: future,
    });

    const result = await validateBrowserToken("good-token");
    expect(result).toBe("user-abc");
  });

  it("returns null when token does not match any session", async () => {
    (db.query.session.findFirst as any).mockResolvedValueOnce(null);

    const result = await validateBrowserToken("bad-token");
    expect(result).toBeNull();
  });

  it("returns null when session is expired", async () => {
    const past = new Date(Date.now() - 1000);
    (db.query.session.findFirst as any).mockResolvedValueOnce({
      id: "sess-1",
      token: "old-token",
      userId: "user-abc",
      expiresAt: past,
    });

    const result = await validateBrowserToken("old-token");
    expect(result).toBeNull();
  });

  it("returns null for empty token", async () => {
    expect(await validateBrowserToken("")).toBeNull();
    expect(db.query.session.findFirst).not.toHaveBeenCalled();
  });
});

describe("validateDaemonAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns userId when api key and workspaceId both match", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValueOnce({
      id: "key-1",
      userId: "user-abc",
      keyHash: "hashed",
      revokedAt: null,
      expiresAt: null,
    });
    (db.query.workspaces.findFirst as any).mockResolvedValueOnce({
      id: "ws-1",
      ownerUserId: "user-abc",
    });

    const result = await validateDaemonAuth("bob_live_xyz", "ws-1");
    expect(result).toBe("user-abc");
  });

  it("returns null when api key is revoked", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValueOnce({
      id: "key-1",
      userId: "user-abc",
      keyHash: "hashed",
      revokedAt: new Date(),
      expiresAt: null,
    });

    const result = await validateDaemonAuth("bob_live_xyz", "ws-1");
    expect(result).toBeNull();
  });

  it("returns null when api key is expired", async () => {
    const past = new Date(Date.now() - 1000);
    (db.query.apiKeys.findFirst as any).mockResolvedValueOnce({
      id: "key-1",
      userId: "user-abc",
      keyHash: "hashed",
      revokedAt: null,
      expiresAt: past,
    });

    const result = await validateDaemonAuth("bob_live_xyz", "ws-1");
    expect(result).toBeNull();
  });

  it("returns null when workspace does not belong to the api key's user", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValueOnce({
      id: "key-1",
      userId: "user-abc",
      keyHash: "hashed",
      revokedAt: null,
      expiresAt: null,
    });
    (db.query.workspaces.findFirst as any).mockResolvedValueOnce({
      id: "ws-1",
      ownerUserId: "someone-else",
    });

    const result = await validateDaemonAuth("bob_live_xyz", "ws-1");
    expect(result).toBeNull();
  });

  it("returns null when api key is missing", async () => {
    expect(await validateDaemonAuth("", "ws-1")).toBeNull();
    expect(await validateDaemonAuth("bob_live_xyz", "")).toBeNull();
  });
});

describe("assertNoAuthBypassInProduction (refuse-to-boot guard)", () => {
  it("throws when BOB_AUTH_BYPASS is set under NODE_ENV=production", () => {
    expect(() =>
      assertNoAuthBypassInProduction({ NODE_ENV: "production", BOB_AUTH_BYPASS: "true" }),
    ).toThrow(/refusing to boot/);
  });

  it("throws when BOB_AUTH_BYPASS is set under BOB_ENV=production", () => {
    expect(() =>
      assertNoAuthBypassInProduction({ BOB_ENV: "production", BOB_AUTH_BYPASS: "true" }),
    ).toThrow(/refusing to boot/);
  });

  it("allows the bypass in non-production environments", () => {
    expect(() =>
      assertNoAuthBypassInProduction({ NODE_ENV: "development", BOB_AUTH_BYPASS: "true" }),
    ).not.toThrow();
  });

  it("allows production without the bypass", () => {
    expect(() =>
      assertNoAuthBypassInProduction({ NODE_ENV: "production" }),
    ).not.toThrow();
  });
});

describe("validateInternalBearer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NUDGE_SHARED_SECRET;
    delete process.env.BOB_ALLOW_LEGACY_NUDGE_SECRET;
  });

  afterEach(() => {
    delete process.env.NUDGE_SHARED_SECRET;
    delete process.env.BOB_ALLOW_LEGACY_NUDGE_SECRET;
  });

  it("accepts a valid, unrevoked, unexpired API key", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValue({
      userId: "user-1",
      revokedAt: null,
      expiresAt: null,
    });
    expect(await validateInternalBearer("bob_live_key")).toBe(true);
  });

  it("rejects a revoked API key even when it hashes correctly", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValue({
      userId: "user-1",
      revokedAt: new Date().toISOString(),
      expiresAt: null,
    });
    expect(await validateInternalBearer("bob_live_key")).toBe(false);
  });

  it("accepts the legacy shared secret only while the ramp is open", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValue(null);
    process.env.NUDGE_SHARED_SECRET = "legacy-secret";
    expect(await validateInternalBearer("legacy-secret")).toBe(true);
  });

  it("rejects the legacy secret once BOB_ALLOW_LEGACY_NUDGE_SECRET=false", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValue(null);
    process.env.NUDGE_SHARED_SECRET = "legacy-secret";
    process.env.BOB_ALLOW_LEGACY_NUDGE_SECRET = "false";
    expect(await validateInternalBearer("legacy-secret")).toBe(false);
  });

  it("rejects everything else", async () => {
    (db.query.apiKeys.findFirst as any).mockResolvedValue(null);
    expect(await validateInternalBearer("nonsense")).toBe(false);
    expect(await validateInternalBearer("")).toBe(false);
  });
});
