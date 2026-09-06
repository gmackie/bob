import { describe, expect, it, vi } from "vitest";
vi.mock("@bob/db/client", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) } }));
import { createTRPCContext } from "../../trpc";
import { resolveTrustedLocalFilesystem } from "../trusted-local-filesystem";

const config = { proxySecret: "per-launch-private-fixture", roots: ["/tmp/project"] };

describe("trusted local filesystem composition", () => {
  it("requires both the private proxy marker and an independently authenticated principal", async () => {
    const headers = new Headers({ "x-bob-local-operator": config.proxySecret });
    const session = { user: { id: "signed-in-user" }, session: { id: "session" } };
    const getSession = vi.fn().mockResolvedValue(session);
    const authBundle = { authInstance: { api: { getSession } } } as never;
    const ctx = await createTRPCContext({ headers, authBundle, localFilesystem: config });
    expect(ctx.filesystem).toEqual({ kind: "local-operator", userId: "signed-in-user", roots: config.roots });
    const forged = await createTRPCContext({ headers: new Headers({ "x-bob-local-operator": "forged" }), authBundle, localFilesystem: config });
    expect(forged.session?.user.id).toBe("signed-in-user");
    expect(forged.filesystem).toBeUndefined();
    getSession.mockResolvedValue(null);
    const anonymous = await createTRPCContext({ headers, authBundle, localFilesystem: config });
    expect(anonymous.session).toBeNull();
    expect(anonymous.filesystem).toBeUndefined();
  });
  it("cannot grant authority when hosted composition has no local config", () => {
    expect(resolveTrustedLocalFilesystem(undefined, "user", new Headers({ "x-bob-local-operator": config.proxySecret }))).toBeUndefined();
  });
});
