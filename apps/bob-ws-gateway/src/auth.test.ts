import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { validateBrowserToken, validateDaemonAuth } from "./auth.js";

describe("validateBrowserToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
