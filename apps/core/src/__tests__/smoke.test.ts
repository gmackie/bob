import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = Number(process.env.CORE_SMOKE_PORT ?? 3500);
const postgresUrl = process.env.CORE_SMOKE_DATABASE_URL;
if (process.env.CORE_SMOKE_REQUIRE_POSTGRES === "1" && !postgresUrl)
  throw new Error("CORE_SMOKE_DATABASE_URL required");
const BASE_URL = `http://localhost:${PORT}`;

// Resolve the apps/core directory from the test file's runtime cwd. Vitest
// runs each project in its own package root, so `process.cwd()` is
// `apps/core` regardless of where the worktree lives — sidestepping the
// hardcoded absolute path that broke this test when the worktree moved
// across phases (e.g. phase-6k-wire → phase-6l-stubs).
const APP_DIR = resolve(process.cwd());

// Test-specific account credentials — randomized per run so each smoke run
// gets a fresh user row. The PGlite data dir is also fresh per run, so this
// is belt-and-braces.
const TEST_EMAIL = `smoke-${Date.now()}@example.test`;
const TEST_PASSWORD = "smoke-test-password-123";
const TEST_NAME = "Smoke Test User";

let server: ChildProcess;
let serverOutput = "";
// Cookie jar — accumulates Set-Cookie headers from auth + RPC responses
// across the describe block so we can ferry the session cookie back in
// follow-up requests.
let cookieJar = new Map<string, string>();
let pgliteDir: string;

function cookieHeader(): string {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function ingestSetCookie(res: Response): void {
  // `Response.headers.get("set-cookie")` joins multiple set-cookie headers
  // with a comma, which is ambiguous for cookie values that contain commas
  // (better-auth's signed cookies do). Use `getSetCookie()` (Node 20+)
  // when available, fall back to the joined string.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headersAny = res.headers as any;
  const raw: string[] =
    typeof headersAny.getSetCookie === "function"
      ? (headersAny.getSetCookie() as string[])
      : (() => {
          const v = res.headers.get("set-cookie");
          return v ? [v] : [];
        })();
  for (const cookieStr of raw) {
    const firstSegment = cookieStr.split(";")[0]!;
    const eqIdx = firstSegment.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = firstSegment.slice(0, eqIdx).trim();
    const value = firstSegment.slice(eqIdx + 1).trim();
    cookieJar.set(name, value);
  }
}

beforeAll(async () => {
  // Per-test PGlite data directory — the default (`~/.gmacko/data`) needs
  // the parent `~/.gmacko` to already exist; CI runners typically don't
  // have it. Routing PGlite to `os.tmpdir()/<rand>` sidesteps that and
  // gives us a clean DB per run.
  pgliteDir = mkdtempSync(join(tmpdir(), "gmacko-web-smoke-"));

  // Test env. Keys called out:
  //   - `GMACKO_AGENT_ADAPTER=mock` — picks the deterministic `mockAdapter`
  //     instead of the Claude Code subprocess adapter.
  //   - `BETTER_AUTH_SECRET` / `GMACKO_SECRET_ENCRYPTION_KEY` — both
  //     required at module load.
  //   - `GMACKO_BETTER_AUTH_EMAIL_PASSWORD=true` — flips on the
  //     /sign-up/email + /sign-in/email endpoints. Off in production.
  //   - `GMACKO_BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION=false` — sign-up
  //     immediately yields a usable account without an email round-trip.
  //   - `PGLITE_DATA_DIR` — see comment above.
  const env = {
    ...process.env,
    PORT: String(PORT),
    GMACKO_DB_DRIVER: postgresUrl ? "postgres" : "pglite",
    DATABASE_URL: postgresUrl ?? "",
    GMACKO_AGENT_ADAPTER: "mock",
    BETTER_AUTH_SECRET: "test-secret-32-chars-minimum-1234",
    GMACKO_SECRET_ENCRYPTION_KEY: "test-key-32-chars-minimum-aaaaaaaa",
    PUBLIC_BASE_URL: BASE_URL,
    PGLITE_DATA_DIR: pgliteDir,
    GMACKO_BETTER_AUTH_EMAIL_PASSWORD: "true",
    GMACKO_BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION: "false",
  };

  // `next dev --webpack` rather than `--turbopack` (which is the package
  // script default). Turbopack's dev pipeline currently misresolves
  // `@gmacko/contracts/groups/agent.ts → "../schemas/agent.js"` despite
  // the `turbopack.resolveAlias` map in next.config.ts.
  server = spawn(
    "pnpm",
    ["exec", "next", "dev", "--webpack", "-p", String(PORT)],
    {
      env,
      cwd: APP_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("next dev did not become ready within 55s")),
      55_000,
    );
    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      serverOutput += text;
      if (
        text.includes("Ready") ||
        text.includes("Local:") ||
        text.includes("compiled successfully")
      ) {
        clearTimeout(timeout);
        resolve();
      }
    };
    server.stdout?.on("data", onChunk);
    server.stderr?.on("data", onChunk);
    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`next dev exited prematurely with code ${code}`));
    });
  });

  // Brief settling delay — Next prints "Ready" before the route handlers
  // are fully wired in some 16.x point releases. 1.5s is plenty.
  await new Promise((r) => setTimeout(r, 1_500));

  // Force a client-bundle compile of `src/app/page.tsx` so any
  // transitive Node-only import that webpack can't satisfy fails
  // here rather than going undetected. Without this, the smoke
  // test only hits server routes (/api/auth/*, /api/rpc) and
  // never exercises the client bundle. Body content is irrelevant —
  // we only need the compile to attempt.
  const page = await fetch(`${BASE_URL}/`);
  expect(page.status).toBe(200);
  await page.text();
}, 180_000);

afterAll(async () => {
  if (process.env.CORE_SMOKE_SERVER_LOG) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.CORE_SMOKE_SERVER_LOG, serverOutput);
  }
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(() => {
        try {
          server.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        resolve();
      }, 5_000);
      server.on("exit", () => {
        clearTimeout(fallback);
        resolve();
      });
    });
  }
  if (pgliteDir && existsSync(pgliteDir)) {
    try {
      rmSync(pgliteDir, { recursive: true, force: true });
    } catch {
      // Non-fatal: tmp dirs eventually GC.
    }
  }
});

// HTTP RPC consumes NDJSON requests and appends its own Eof. Sending a second
// explicit Eof corrupts the protocol lifetime after the first response.
async function rpcCall(
  tag: string,
  payload: unknown = null,
  opts: { headers?: Record<string, string> } = {},
): Promise<Response> {
  const frames = [{ id: "1", _tag: "Request", tag, payload, headers: [] }];
  const body = frames.map((f) => JSON.stringify(f)).join("\n") + "\n";
  const cookies = cookieHeader();
  const res = await fetch(`${BASE_URL}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/ndjson",
      ...(cookies ? { Cookie: cookies } : {}),
      ...opts.headers,
    },
    body,
  });
  ingestSetCookie(res);
  return res;
}

async function authPost(path: string, body: unknown): Promise<Response> {
  const cookies = cookieHeader();
  const res = await fetch(`${BASE_URL}/api/auth${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify(body),
  });
  ingestSetCookie(res);
  return res;
}

async function authGet(path: string): Promise<Response> {
  const cookies = cookieHeader();
  const res = await fetch(`${BASE_URL}/api/auth${path}`, {
    method: "GET",
    headers: {
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });
  ingestSetCookie(res);
  return res;
}

async function rpcExit(tag: string, payload: unknown = null) {
  const res = await rpcCall(tag, payload);
  expect(res.status).toBe(200);
  const frames = (await res.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const frame = frames.find((f) => f._tag === "Exit");
  expect(frame).toBeDefined();
  return frame.exit;
}

describe("authenticated reference app database smoke", () => {
  it("returns typed identity and scopes persisted sessions to the signed-in account", async () => {
    // Compile both routes before testing; next dev may invalidate shared modules when a new route compiles.
    const warm = await authGet("/get-session");
    expect(warm.status).toBe(200);
    await warm.text();
    const anonymous = await rpcExit("auth.whoAmI");
    expect(anonymous._tag).toBe("Failure");
    expect(JSON.stringify(anonymous)).toContain("UnauthorizedError");
    const signup = await authPost("/sign-up/email", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: TEST_NAME,
    });
    expect(signup.status).toBe(200);
    const user = (await signup.json()).user;
    expect(user.email).toBe(TEST_EMAIL);
    const signin = await authPost("/sign-in/email", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(signin.status).toBe(200);
    await signin.json();
    expect(cookieJar.has("better-auth.session_token")).toBe(true);
    const identity = await rpcExit("auth.whoAmI");
    expect(identity._tag, JSON.stringify(identity)).toBe("Success");
    expect(identity.value).toEqual({
      userId: user.id,
      email: TEST_EMAIL,
      tenantId: expect.any(String),
      role: "owner",
    });
    expect(identity.value.tenantId.length).toBeGreaterThan(0);
    const unsupported = await rpcCall("agent.run.list", {});
    expect(unsupported.status).toBe(200);
    const unsupportedFrame = JSON.parse((await unsupported.text()).trim());
    expect(unsupportedFrame._tag).toBe("Defect");
    expect(JSON.stringify(unsupportedFrame)).toContain(
      "Unknown request tag: agent.run.list",
    );
    const created = await rpcExit("agent.createSession", {
      adapterId: "mock",
      title: "smoke owned session",
    });
    expect(created._tag, JSON.stringify(created)).toBe("Success");
    expect(created.value).toEqual({
      conversationId: expect.any(String),
      status: expect.any(String),
    });
    const transcript = await rpcExit("agent.getTranscript", {
      conversationId: created.value.conversationId,
    });
    expect(transcript._tag).toBe("Success");
    cookieJar.clear();
    const otherSignup = await authPost("/sign-up/email", {
      email: `other-${TEST_EMAIL}`,
      password: TEST_PASSWORD,
      name: "Other account",
    });
    expect(otherSignup.status).toBe(200);
    await otherSignup.json();
    const otherIdentity = await rpcExit("auth.whoAmI");
    expect(otherIdentity._tag).toBe("Success");
    expect(otherIdentity.value.tenantId).not.toBe(identity.value.tenantId);
    if (postgresUrl) {
      expect(readdirSync(pgliteDir)).toEqual([]);
      const { createDatabaseConnection } =
        await import("@gmacko/core/db/client");
      const { users } = await import("@gmacko/core/db/schema");
      const { eq } = await import("drizzle-orm");
      const connection = await createDatabaseConnection({
        driver: "postgres",
        url: postgresUrl,
      });
      try {
        const [persisted] = await connection.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, TEST_EMAIL));
        expect(persisted?.id).toBe(user.id);
      } finally {
        await connection.close();
      }
    }
    const denied = await rpcExit("agent.getTranscript", {
      conversationId: created.value.conversationId,
    });
    expect(denied._tag).toBe("Failure");
    expect(JSON.stringify(denied)).toContain("AgentSessionNotFoundError");
  });
});
