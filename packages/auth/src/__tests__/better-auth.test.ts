import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@gmacko/core/db/schema";
import { runMigrations } from "@gmacko/core/db/migrate";
import { tenants, tenantMembers } from "@gmacko/core/db/schema/tenancy";
import { users as usersTable } from "@gmacko/core/db/schema/auth";

import {
  BetterAuth,
  initAuth,
  layerBetterAuth,
} from "../better-auth.js";

const baseOpts = () => {
  const pglite = new PGlite();
  const db = drizzle(pglite);
  return {
    db,
    baseUrl: "http://localhost:3000",
    productionUrl: "http://localhost:3000",
    secret: "test_secret_at_least_32_chars_long_ok",
    githubClientId: "test-gh",
    githubClientSecret: "test-gh-secret",
  };
};

describe("@gmacko/auth BetterAuth service", () => {
  it("initAuth returns a usable better-auth instance", () => {
    const auth = initAuth(baseOpts());

    expect(typeof auth.api.getSession).toBe("function");
    expect(Array.isArray(auth.options.trustedOrigins)).toBe(true);
  });

  it("initAuth dedupes built-ins and merges extra trustedOrigins", () => {
    const auth = initAuth({
      ...baseOpts(),
      trustedOrigins: ["https://example.com"],
    });

    // Input trustedOrigins is either a string[] or a function; we pass string[],
    // so better-auth preserves it as a string[] on options.
    const origins = auth.options.trustedOrigins;
    if (!Array.isArray(origins)) {
      throw new Error(
        `expected options.trustedOrigins to be a string[], got ${typeof origins}`,
      );
    }

    expect(origins).toContain("expo://");
    expect(origins).toContain("gmacko://");
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("https://example.com");

    // baseUrl === productionUrl === http://localhost:3000 -> should dedupe.
    const localhostCount = origins.filter(
      (o) => o === "http://localhost:3000",
    ).length;
    expect(localhostCount).toBe(1);
  });

  it("layerBetterAuth provides the passed AuthInstance via BetterAuth tag", async () => {
    const auth = initAuth(baseOpts());

    const program = Effect.gen(function* () {
      return yield* BetterAuth.asEffect();
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layerBetterAuth(auth))),
    );

    expect(result).toBe(auth);
  });
});

describe("initAuth tenant bootstrap", () => {
  let pglite: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    pglite = new PGlite();
    db = drizzle(pglite, { schema });
    await runMigrations(pglite);
  });

  it("creates a personal tenant + tenant_members row when a user signs up", async () => {
    const auth = initAuth({
      db,
      schema: schema as unknown as Record<string, unknown>,
      pluralizeTables: true,
      baseUrl: "http://localhost:3000",
      productionUrl: "http://localhost:3000",
      secret: "test-secret-32-chars-minimum-1234",
      githubClientId: "x",
      githubClientSecret: "x",
      emailAndPassword: { enabled: true, requireEmailVerification: false },
    });

    await auth.api.signUpEmail({
      body: {
        email: "alice@example.test",
        password: "password-123",
        name: "Alice",
      },
    });

    const tenantRows = await db.select().from(tenants);
    expect(tenantRows.length).toBe(1);
    const memberRows = await db.select().from(tenantMembers);
    expect(memberRows.length).toBe(1);
    expect(memberRows[0]?.role).toBe("owner");
    const userRows = await db.select().from(usersTable);
    expect(memberRows[0]?.tenantId).toBe(tenantRows[0]?.id);
    expect(memberRows[0]?.userId).toBe(userRows[0]?.id);
  });
});
