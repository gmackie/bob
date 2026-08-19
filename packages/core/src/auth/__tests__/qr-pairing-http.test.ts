import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import * as schema from "@gmacko/core/db/schema";
import { runMigrations } from "@gmacko/core/db/migrate";
import { initAuth } from "../better-auth.js";

describe("qr-pairing over HTTP handler", () => {
  it("create without session returns 401 not 500", async () => {
    const pglite = new PGlite();
    const db = drizzle(pglite, { schema });
    await runMigrations(pglite);
    const auth = initAuth({
      db,
      schema: schema as unknown as Record<string, unknown>,
      pluralizeTables: true,
      baseUrl: "http://localhost:3000",
      productionUrl: "http://localhost:3000",
      secret: "test-secret-32-chars-minimum-1234",
      githubClientId: "x",
      githubClientSecret: "x",
      bootstrapTenancy: false,
    });

    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/qr-pairing/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const text = await res.text();
    console.log("HTTP status:", res.status, "body:", text.slice(0, 300));
    expect(res.status).toBe(401);
  });
});
