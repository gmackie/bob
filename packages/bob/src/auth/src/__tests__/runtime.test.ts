import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makePgliteDb  } from "@bob/db/client-pglite";
import type {PgliteDbHandle} from "@bob/db/client-pglite";
import * as bobSchema from "@bob/db/schema";

import {
  createAuthRuntime,
  Sessions

} from "../runtime.js";
import type {AuthRuntime} from "../runtime.js";

// ---------------------------------------------------------------------------
// Test-scoped PGlite + auth runtime
// ---------------------------------------------------------------------------

let handle: PgliteDbHandle;
let runtime: AuthRuntime;

beforeEach(async () => {
  // In-memory PGlite with Bob's full schema (including gmacko auth tables
  // from Task 1). The `makePgliteDb` bootstrap applies all schema DDL.
  handle = await makePgliteDb({ dataDir: ":memory:" });

  const bundle = createAuthRuntime({
    db: handle.db,
    // Pass Bob's schema so better-auth's drizzle adapter can resolve tables.
    // Bob's schema includes gmacko's plural auth tables (users, sessions, etc.)
    // via the re-exports added in Task 1.
    schema: bobSchema,
    pluralizeTables: true,
    baseUrl: "http://localhost:5173",
    productionUrl: "http://localhost:5173",
    secret: "test-secret-at-least-32-chars-long!!",
    githubClientId: "test-github-client-id",
    githubClientSecret: "test-github-client-secret",
    // Disable tenant bootstrap for test isolation — we're testing the
    // runtime bridge itself, not the sign-up flow.
    bootstrapTenancy: false,
  });
  runtime = bundle.runtime;
});

afterEach(async () => {
  await runtime.dispose();
  await handle.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createAuthRuntime", () => {
  it("returns a ManagedRuntime that can be disposed", async () => {
    // The runtime was created in beforeEach; disposing it should not throw.
    // We create a second runtime to test the dispose path explicitly (the
    // afterEach cleanup handles the main one).
    const bundle2 = createAuthRuntime({
      db: handle.db,
      schema: bobSchema,
      pluralizeTables: true,
      baseUrl: "http://localhost:5173",
      productionUrl: "http://localhost:5173",
      secret: "test-secret-at-least-32-chars-long!!",
      githubClientId: "test-github-client-id",
      githubClientSecret: "test-github-client-secret",
      bootstrapTenancy: false,
    });

    // Disposing should resolve cleanly.
    await expect(bundle2.runtime.dispose()).resolves.toBeUndefined();
  });

  it("resolves Sessions.validateRequest with empty headers (session error)", async () => {
    // With no session cookie / bearer token, validateRequest should fail
    // with a SessionExpiredError — the point is the runtime resolves and
    // the Effect service graph works end-to-end without crashing.
    const program = Effect.gen(function* () {
      const sessions = yield* Sessions.asEffect();
      return yield* sessions
        .validateRequest(new Headers())
        .pipe(
          Effect.catchTag("SessionExpiredError", (err) =>
            Effect.succeed({ caught: true, message: err.message }),
          ),
        );
    });

    const result = await runtime.runPromise(program);
    expect(result).toHaveProperty("caught", true);
  });

  it("resolves Sessions.validateToken with an unknown token (session error)", async () => {
    const program = Effect.gen(function* () {
      const sessions = yield* Sessions.asEffect();
      return yield* sessions
        .validateToken("nonexistent-token")
        .pipe(
          Effect.catchTag("SessionExpiredError", (err) =>
            Effect.succeed({ caught: true, message: err.message }),
          ),
        );
    });

    const result = await runtime.runPromise(program);
    expect(result).toHaveProperty("caught", true);
    expect(result).toHaveProperty("message");
  });
});
