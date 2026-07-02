import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ConnectionWithDecryptedToken } from "../providerConnectionService";

// The service imports `@bob/db/client`, which requires DATABASE_URL at module
// load. These tests never touch the DB, so a dummy connection string is enough;
// the module is imported dynamically after the env is set.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

let checkConnectionHealth: typeof import("../providerConnectionService").checkConnectionHealth;
let isAuthFailure: typeof import("../providerConnectionService").isAuthFailure;

beforeAll(async () => {
  const mod = await import("../providerConnectionService");
  checkConnectionHealth = mod.checkConnectionHealth;
  isAuthFailure = mod.isAuthFailure;
});

function makeConnection(
  overrides: Partial<ConnectionWithDecryptedToken> = {},
): ConnectionWithDecryptedToken {
  return {
    id: "conn-1",
    userId: "user-1",
    provider: "github",
    instanceUrl: null,
    providerAccountId: "acct-1",
    providerUsername: "octocat",
    scopes: "repo",
    accessToken: "token-abc",
    refreshToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isAuthFailure", () => {
  it("flags auth-related errors as re-authenticatable", () => {
    expect(isAuthFailure(new Error("ForgeGraph 401"))).toBe(true);
    expect(isAuthFailure(new Error("403 Forbidden"))).toBe(true);
    expect(isAuthFailure(new Error("Bad credentials"))).toBe(true);
    expect(isAuthFailure(new Error("token has expired"))).toBe(true);
    expect(isAuthFailure(new Error("credential was revoked"))).toBe(true);
    expect(isAuthFailure("Unauthorized")).toBe(true);
  });

  it("does not flag transient/server errors", () => {
    expect(isAuthFailure(new Error("ForgeGraph 500"))).toBe(false);
    expect(isAuthFailure(new Error("network timeout"))).toBe(false);
  });
});

describe("checkConnectionHealth", () => {
  it("reports healthy when credentials verify", async () => {
    const connection = makeConnection();
    const health = await checkConnectionHealth(connection, {
      reauth: async (c) => c.accessToken,
      verify: async () => "octocat",
    });

    expect(health).toMatchObject({
      connectionId: "conn-1",
      provider: "github",
      status: "healthy",
      needsReauth: false,
      error: null,
      providerUsername: "octocat",
    });
  });

  it("uses the refreshed token to verify credentials", async () => {
    const connection = makeConnection({ accessToken: "stale" });
    const verify = vi.fn(async () => "octocat");

    await checkConnectionHealth(connection, {
      reauth: async () => "fresh-token",
      verify,
    });

    expect(verify).toHaveBeenCalledWith("github", "fresh-token", null);
  });

  it("marks the connector unhealthy and needing re-auth when refresh fails", async () => {
    const connection = makeConnection({ provider: "github" });
    const verify = vi.fn();

    const health = await checkConnectionHealth(connection, {
      reauth: async () => {
        throw new Error("Access token expired and no refresh token available");
      },
      verify,
    });

    expect(health.status).toBe("unhealthy");
    expect(health.needsReauth).toBe(true);
    expect(health.error).toContain("expired");
    // Verification is skipped once re-authentication fails.
    expect(verify).not.toHaveBeenCalled();
  });

  it("marks the connector as needing re-auth on an auth verification failure", async () => {
    const connection = makeConnection();

    const health = await checkConnectionHealth(connection, {
      reauth: async (c) => c.accessToken,
      verify: async () => {
        throw new Error("ForgeGraph 401");
      },
    });

    expect(health.status).toBe("unhealthy");
    expect(health.needsReauth).toBe(true);
    expect(health.error).toContain("401");
  });

  it("stays unhealthy but does not demand re-auth on a transient failure", async () => {
    const connection = makeConnection();

    const health = await checkConnectionHealth(connection, {
      reauth: async (c) => c.accessToken,
      verify: async () => {
        throw new Error("ForgeGraph 500");
      },
    });

    expect(health.status).toBe("unhealthy");
    expect(health.needsReauth).toBe(false);
  });

  it("verifies ForgeGraph connectors by provider name", async () => {
    const connection = makeConnection({
      id: "conn-fg",
      provider: "forgegraph" as ConnectionWithDecryptedToken["provider"],
      instanceUrl: "https://forgegraf.com",
      providerUsername: "forgegraph",
    });
    const verify = vi.fn(async () => null);

    const health = await checkConnectionHealth(connection, {
      reauth: async (c) => c.accessToken,
      verify,
    });

    expect(verify).toHaveBeenCalledWith(
      "forgegraph",
      "token-abc",
      "https://forgegraf.com",
    );
    expect(health.status).toBe("healthy");
    // Falls back to the stored username when verify returns null.
    expect(health.providerUsername).toBe("forgegraph");
  });
});
