import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, it, expect } from "vitest";
import { makeOAuthStore } from "./store";
import type { Db } from "@bob/db/client";
import { digest } from "./oauth";

describe("durable OAuth storage", () => {
  it("applies the migration, atomically consumes credentials, rolls back failed exchanges, and cascades deletion", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(
        "CREATE TABLE users(id text PRIMARY KEY); CREATE TABLE workspaces(id uuid PRIMARY KEY); INSERT INTO users VALUES ('alice'); INSERT INTO workspaces VALUES ('aaaabbbb-1111-4000-8000-000000000001');",
      );
      await pg.exec(
        await readFile(
          new URL(
            "../../../../../packages/bob/src/db/drizzle/0037_mcp_oauth.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      // Production's Db alias is node-postgres; the store uses only the common
      // Drizzle query/transaction API, exercised here against real PGlite SQL.
      const store = makeOAuthStore(
        drizzle(pg, { casing: "snake_case" }) as unknown as Db,
      );
      await store.addClient({
        id: "client",
        name: "Test",
        redirectUris: ["https://client.example/cb"],
      });
      expect(await store.client("client")).toMatchObject({
        redirectUris: ["https://client.example/cb"],
      });
      await store.addGrant({
        id: "grant",
        clientId: "client",
        userId: "alice",
        workspaceId: "aaaabbbb-1111-4000-8000-000000000001",
        scopes: ["bob:read"],
        resource: "https://bob.example/mcp",
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: null,
      });
      const hash = await digest("credential");
      await store.addCredential({
        hash,
        kind: "refresh",
        grantId: "grant",
        data: { scopes: ["bob:read"] },
        expiresAt: new Date(Date.now() + 100000),
        usedAt: null,
      });
      await expect(
        store.transaction(async (tx) => {
          expect(await tx.consume(hash)).toBeDefined();
          throw new Error("Mint failed");
        }),
      ).rejects.toThrow("Mint failed");
      expect((await store.credential(hash))?.usedAt).toBeNull();
      const consumed = await Promise.all([
        store.consume(hash),
        store.consume(hash),
      ]);
      expect(consumed.filter(Boolean)).toHaveLength(1);
      await store.revoke("grant");
      expect((await store.grant("grant"))?.revokedAt).toBeInstanceOf(Date);
      await pg.exec("DELETE FROM users WHERE id = 'alice'");
      expect(await store.grant("grant")).toBeUndefined();
      expect(await store.credential(hash)).toBeUndefined();
    } finally {
      await pg.close();
    }
  }, 30000);
});
