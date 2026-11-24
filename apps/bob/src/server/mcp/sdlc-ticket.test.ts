import { describe, expect, it, vi } from "vitest";
import { consumeSdlcTicket, issueSdlcTicket } from "./sdlc-ticket";
import type { Credential, OAuthGrant } from "./types";

const grant: OAuthGrant = {
  id: "grant",
  clientId: "client",
  userId: "alice",
  workspaceId: "workspace",
  scopes: ["bob:read", "bob:write"],
  resource: "https://bob.example/mcp",
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
};

function store(current: OAuthGrant | null = grant) {
  const credentials = new Map<string, Credential>();
  return {
    credentials,
    addCredential: vi.fn(async (credential: Credential) => {
      credentials.set(credential.hash, credential);
    }),
    credential: async (hash: string) => credentials.get(hash),
    consume: vi.fn(async (hash: string) => {
      const credential = credentials.get(hash);
      if (!credential || credential.usedAt) return undefined;
      credential.usedAt = new Date();
      return credential;
    }),
    grant: vi.fn(async () => current ?? undefined),
  };
}

const redeem = (s: ReturnType<typeof store>, ticket: string, workspaceId = grant.workspaceId, canWrite = true) =>
  consumeSdlcTicket(s, ticket, workspaceId, async () => canWrite);

describe("SDLC socket tickets", () => {
  it("resolves to the grant's user exactly once, and stores only the ticket's hash", async () => {
    const s = store();
    const ticket = await issueSdlcTicket(s, grant);
    expect([...s.credentials.keys()]).not.toContain(ticket);
    expect([...s.credentials.values()][0]).toMatchObject({ kind: "sdlc_ticket", grantId: "grant" });
    expect(await redeem(s, ticket, "other-workspace")).toBeNull();
    expect(await redeem(s, ticket, grant.workspaceId, false)).toBeNull();
    expect(await redeem(s, ticket)).toBe("alice");
    expect(await redeem(s, ticket)).toBeNull();
  });

  it("refuses expired tickets, other credential kinds, and tickets of revoked or expired grants", async () => {
    const s = store();
    const expired = await issueSdlcTicket(s, grant);
    [...s.credentials.values()][0]!.expiresAt = new Date(Date.now() - 1);
    expect(await redeem(s, expired)).toBeNull();

    const other = await issueSdlcTicket(s, grant);
    for (const credential of s.credentials.values()) credential.kind = "access";
    expect(await redeem(s, other)).toBeNull();

    for (const current of [{ ...grant, scopes: ["bob:read"] }, { ...grant, revokedAt: new Date() }, { ...grant, expiresAt: new Date(Date.now() - 1) }, null]) {
      const r = store(current);
      expect(await redeem(r, await issueSdlcTicket(r, grant))).toBeNull();
    }
    expect(await redeem(s, "")).toBeNull();
  });
});
