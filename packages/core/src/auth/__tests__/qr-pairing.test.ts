import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@gmacko/core/db/schema";
import { runMigrations } from "@gmacko/core/db/migrate";

import { initAuth, type AuthInstance } from "../better-auth.js";
import type { QrPairingApi } from "../qr-pairing.js";

// SAFETY: initAuth() returns the plugin-erased `ReturnType<typeof betterAuth>`,
// so the qr-pairing endpoints (registered unconditionally in initAuth's plugin
// array) are present at runtime but invisible to InferAPI. QrPairingApi mirrors
// their exact signatures.
const qrApi = (auth: AuthInstance) => auth.api as unknown as QrPairingApi;

// The qr-pairing plugin lets an authenticated session (Bob web) mint a
// short-lived one-time pairing code, rendered as a QR that the mobile app
// scans. Claiming the code mints a REAL better-auth session for the code's
// creator — same session model as OAuth sign-in, so useSession()/signOut()
// on the client work unchanged.

const makeAuth = (db: unknown) =>
  initAuth({
    db,
    schema: schema as unknown as Record<string, unknown>,
    pluralizeTables: true,
    baseUrl: "http://localhost:3000",
    productionUrl: "http://localhost:3000",
    secret: "test-secret-32-chars-minimum-1234",
    githubClientId: "x",
    githubClientSecret: "x",
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    bootstrapTenancy: false,
  });

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function signUpAndGetCookies(
  auth: AuthInstance,
  email: string,
): Promise<{ cookies: string; userId: string }> {
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: "password-123", name: "QR Tester" },
    returnHeaders: true,
  });
  return { cookies: cookieHeader(headers), userId: response.user.id };
}

describe("qr-pairing plugin", () => {
  let auth: AuthInstance;

  beforeEach(async () => {
    const pglite = new PGlite();
    const db = drizzle(pglite, { schema });
    await runMigrations(pglite);
    auth = makeAuth(db);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("create requires an authenticated session", async () => {
    await expect(
      qrApi(auth).createQrPairingCode({ headers: new Headers() }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("create returns a one-time code with an expiry", async () => {
    const { cookies } = await signUpAndGetCookies(auth, "web@example.test");

    const result = await qrApi(auth).createQrPairingCode({
      headers: new Headers({ cookie: cookies }),
    });

    expect(result.code.length).toBeGreaterThanOrEqual(32);
    expect(result.expiresIn).toBeGreaterThan(0);
  });

  it("claim mints a real session for the code creator", async () => {
    const { cookies, userId } = await signUpAndGetCookies(
      auth,
      "web2@example.test",
    );
    const { code } = await qrApi(auth).createQrPairingCode({
      headers: new Headers({ cookie: cookies }),
    });

    const { headers, response } = await qrApi(auth).claimQrPairingCode({
      body: { code },
      returnHeaders: true,
    });

    expect(response.user.id).toBe(userId);
    expect(response.token).toBeTruthy();

    // The set-cookie from claim must be a working better-auth session.
    const claimedSession = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader(headers) }),
    });
    expect(claimedSession?.user.id).toBe(userId);
  });

  it("a code is single-use", async () => {
    const { cookies } = await signUpAndGetCookies(auth, "web3@example.test");
    const { code } = await qrApi(auth).createQrPairingCode({
      headers: new Headers({ cookie: cookies }),
    });

    await qrApi(auth).claimQrPairingCode({ body: { code } });

    await expect(
      qrApi(auth).claimQrPairingCode({ body: { code } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects an unknown code", async () => {
    await expect(
      qrApi(auth).claimQrPairingCode({
        body: { code: "not-a-real-code-but-long-enough-to-pass-zod" },
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects an expired code", async () => {
    const { cookies } = await signUpAndGetCookies(auth, "web4@example.test");
    const { code } = await qrApi(auth).createQrPairingCode({
      headers: new Headers({ cookie: cookies }),
    });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);

    await expect(
      qrApi(auth).claimQrPairingCode({ body: { code } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("status transitions pending -> claimed", async () => {
    const { cookies } = await signUpAndGetCookies(auth, "web5@example.test");
    const authedHeaders = new Headers({ cookie: cookies });
    const { code } = await qrApi(auth).createQrPairingCode({
      headers: authedHeaders,
    });

    const before = await qrApi(auth).qrPairingStatus({
      body: { code },
      headers: authedHeaders,
    });
    expect(before.status).toBe("pending");

    await qrApi(auth).claimQrPairingCode({ body: { code } });

    const after = await qrApi(auth).qrPairingStatus({
      body: { code },
      headers: authedHeaders,
    });
    expect(after.status).toBe("claimed");
  });

  it("status reports expired for an unknown/expired code", async () => {
    const { cookies } = await signUpAndGetCookies(auth, "web6@example.test");

    const result = await qrApi(auth).qrPairingStatus({
      body: { code: "unknown-code-that-was-never-created-here" },
      headers: new Headers({ cookie: cookies }),
    });
    expect(result.status).toBe("expired");
  });
});

describe("qr-pairing device-code flow (typed code + web approval)", () => {
  let auth: AuthInstance;

  beforeEach(async () => {
    const pglite = new PGlite();
    const db = drizzle(pglite, { schema });
    await runMigrations(pglite);
    auth = makeAuth(db);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("request returns a typeable user code and a device secret", async () => {
    const result = await qrApi(auth).requestQrPairingDeviceCode({});

    expect(result.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(result.deviceCode.length).toBeGreaterThanOrEqual(32);
    expect(result.interval).toBeGreaterThan(0);
  });

  it("poll reports pending before approval", async () => {
    const { deviceCode } = await qrApi(auth).requestQrPairingDeviceCode({});

    const result = await qrApi(auth).pollQrPairingDeviceCode({
      body: { deviceCode },
    });
    expect(result.status).toBe("pending");
  });

  it("approve requires an authenticated session", async () => {
    const { userCode } = await qrApi(auth).requestQrPairingDeviceCode({});

    await expect(
      qrApi(auth).approveQrPairingDeviceCode({
        body: { userCode },
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("approve rejects an unknown code", async () => {
    const { cookies } = await signUpAndGetCookies(auth, "dev1@example.test");

    await expect(
      qrApi(auth).approveQrPairingDeviceCode({
        body: { userCode: "AAAA-BBBB" },
        headers: new Headers({ cookie: cookies }),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("approve then poll mints a real session (case/format-insensitive code)", async () => {
    const { cookies, userId } = await signUpAndGetCookies(
      auth,
      "dev2@example.test",
    );
    const { deviceCode, userCode } =
      await qrApi(auth).requestQrPairingDeviceCode({});

    await qrApi(auth).approveQrPairingDeviceCode({
      // lowercase + spaces instead of the dash — normalization must handle it
      body: { userCode: userCode.toLowerCase().replace("-", " ") },
      headers: new Headers({ cookie: cookies }),
    });

    const { headers, response } = await qrApi(auth).pollQrPairingDeviceCode({
      body: { deviceCode },
      returnHeaders: true,
    });

    if (response.status !== "approved") {
      throw new Error(`expected approved, got ${response.status}`);
    }
    expect(response.user.id).toBe(userId);
    expect(response.token).toBeTruthy();

    const claimedSession = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader(headers) }),
    });
    expect(claimedSession?.user.id).toBe(userId);
  });

  it("an approved device code is single-use", async () => {
    const { cookies } = await signUpAndGetCookies(auth, "dev3@example.test");
    const { deviceCode, userCode } =
      await qrApi(auth).requestQrPairingDeviceCode({});

    await qrApi(auth).approveQrPairingDeviceCode({
      body: { userCode },
      headers: new Headers({ cookie: cookies }),
    });
    const first = await qrApi(auth).pollQrPairingDeviceCode({
      body: { deviceCode },
    });
    expect(first.status).toBe("approved");

    const second = await qrApi(auth).pollQrPairingDeviceCode({
      body: { deviceCode },
    });
    expect(second.status).toBe("expired");
  });

  it("a user code cannot be approved twice", async () => {
    const { cookies } = await signUpAndGetCookies(auth, "dev4@example.test");
    const { userCode } = await qrApi(auth).requestQrPairingDeviceCode({});

    await qrApi(auth).approveQrPairingDeviceCode({
      body: { userCode },
      headers: new Headers({ cookie: cookies }),
    });

    await expect(
      qrApi(auth).approveQrPairingDeviceCode({
        body: { userCode },
        headers: new Headers({ cookie: cookies }),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("poll reports expired after the device window lapses", async () => {
    const { deviceCode } = await qrApi(auth).requestQrPairingDeviceCode({});

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    const result = await qrApi(auth).pollQrPairingDeviceCode({
      body: { deviceCode },
    });
    expect(result.status).toBe("expired");
  });
});
