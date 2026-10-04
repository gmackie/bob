import { describe, expect, it } from "vitest";

import { isVaultOnlyTrpcPath, signVaultAssertion, verifyVaultAssertion } from "../origin-assertion";

const secret = "s".repeat(40);
const request = { method: "POST", pathAndQuery: "/api/trpc/vault.write?batch=1", body: '{"0":{"json":{}}}' };

describe("vault origin assertion", () => {
  it("round-trips the actor for the exact request", async () => {
    const header = await signVaultAssertion(secret, "user-1", request, 1_000_000);
    expect(await verifyVaultAssertion(secret, header, request, 1_030_000)).toBe("user-1");
  });

  it("rejects a different secret, request, body, method or stale time", async () => {
    const header = await signVaultAssertion(secret, "user-1", request, 1_000_000);
    expect(await verifyVaultAssertion("t".repeat(40), header, request, 1_000_000)).toBeNull();
    expect(await verifyVaultAssertion(secret, header, { ...request, body: "{}" }, 1_000_000)).toBeNull();
    expect(await verifyVaultAssertion(secret, header, { ...request, method: "GET" }, 1_000_000)).toBeNull();
    expect(await verifyVaultAssertion(secret, header, { ...request, pathAndQuery: "/api/trpc/vault.delete?batch=1" }, 1_000_000)).toBeNull();
    expect(await verifyVaultAssertion(secret, header, request, 1_061_000)).toBeNull();
  });

  it("rejects actor substitution, malformed headers and short or missing secrets", async () => {
    const [v, , ts, sig] = (await signVaultAssertion(secret, "user-1", request, 1_000_000)).split(".");
    const forged = [v, btoa("user-2").replace(/=+$/, ""), ts, sig].join(".");
    expect(await verifyVaultAssertion(secret, forged, request, 1_000_000)).toBeNull();
    for (const header of [null, "", "v1.x.y", "v2.dXNlcg.1.ab"]) {
      expect(await verifyVaultAssertion(secret, header, request, 1_000_000)).toBeNull();
    }
    expect(await verifyVaultAssertion(undefined, "v1.a.1." + "0".repeat(64), request)).toBeNull();
    await expect(signVaultAssertion("short", "user-1", request)).rejects.toThrow("too short");
  });

  it("recognises vault-only batches", () => {
    expect(isVaultOnlyTrpcPath("/api/trpc/vault.list")).toBe(true);
    expect(isVaultOnlyTrpcPath("/api/trpc/vault.list,vault.read")).toBe(true);
    expect(isVaultOnlyTrpcPath("/api/trpc/vault.list%2Cvault.read")).toBe(true);
    expect(isVaultOnlyTrpcPath("/api/trpc/vault.list,threads.list")).toBe(false);
    expect(isVaultOnlyTrpcPath("/api/trpc/threads.list")).toBe(false);
    expect(isVaultOnlyTrpcPath("/api/v1/vault")).toBe(false);
  });
});
