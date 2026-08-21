// QR device-pairing plugin for better-auth.
//
// Flow: an authenticated web session calls `/qr-pairing/create` to mint a
// short-lived one-time code (rendered as a QR on the web). The mobile app
// scans it and calls `/qr-pairing/claim`, which mints a REAL better-auth
// session for the code's creator and sets the session cookie — the same
// session model as OAuth sign-in, so client-side useSession()/signOut()
// work unchanged. The web polls `/qr-pairing/status` to show "linked".
//
// Storage rides on better-auth's built-in verification table (no new table):
// - pending:  identifier `qr-pairing:<sha256(code)>`, value {userId}
// - claimed:  identifier `qr-pairing-claimed:<sha256(code)>` (status marker,
//   kept briefly so the web poller can distinguish claimed from expired)
//
// Only the code's hash is stored; the plaintext exists solely in the QR.
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod/v4";

const PENDING_PREFIX = "qr-pairing";
const CLAIMED_PREFIX = "qr-pairing-claimed";
const DEVICE_PREFIX = "qr-pairing-device";
const USER_CODE_PREFIX = "qr-pairing-user";
/** Pairing codes live 2 minutes — long enough to scan, short enough to leak safely. */
const DEFAULT_TTL_MS = 2 * 60 * 1000;
/** How long the "claimed" marker sticks around for the web poller. */
const CLAIMED_MARKER_TTL_MS = 5 * 60 * 1000;
/**
 * Device-code (typed ABCD-EFGH) flow lives longer — the user has to walk to
 * a browser, and in practice that hand-off routinely exceeds 10 minutes.
 * 30 minutes is still safe: 30^8 code space, approve is rate-limited, and
 * approval requires an already-authenticated web session.
 */
const DEVICE_TTL_MS = 30 * 60 * 1000;

/** Crockford-style alphabet: no I/L/O/U/0/1 so codes are unambiguous to type. */
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

function generateUserCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(
    bytes,
    (b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length],
  ).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Uppercase and strip separators so "abcd efgh" matches "ABCD-EFGH". */
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

function generatePairingCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const claimBodySchema = z.object({
  code: z.string().min(16).max(128),
});

const approveBodySchema = z.object({
  userCode: z.string().min(6).max(32),
});

const pollBodySchema = z.object({
  deviceCode: z.string().min(16).max(128),
});

/**
 * Typed view of the qr-pairing endpoints as exposed on `auth.api`.
 *
 * `initAuth()` declares its return as the plugin-erased
 * `ReturnType<typeof betterAuth>`, so callers that invoke these endpoints
 * server-side (tests, route handlers) cast `auth.api` to this interface
 * instead of sprinkling `any`.
 */
export interface QrPairingClaimResult {
  token: string;
  user: { id: string; email: string; name: string };
}

export interface QrPairingApi {
  createQrPairingCode(input: {
    headers: Headers;
  }): Promise<{ code: string; expiresIn: number }>;
  claimQrPairingCode(input: {
    body: { code: string };
    returnHeaders: true;
  }): Promise<{ headers: Headers; response: QrPairingClaimResult }>;
  claimQrPairingCode(input: {
    body: { code: string };
  }): Promise<QrPairingClaimResult>;
  qrPairingStatus(input: {
    body: { code: string };
    headers: Headers;
  }): Promise<{ status: "pending" | "claimed" | "expired" }>;
  requestQrPairingDeviceCode(input?: object): Promise<{
    deviceCode: string;
    userCode: string;
    expiresIn: number;
    interval: number;
  }>;
  approveQrPairingDeviceCode(input: {
    body: { userCode: string };
    headers: Headers;
  }): Promise<{ status: "approved" }>;
  pollQrPairingDeviceCode(input: {
    body: { deviceCode: string };
    returnHeaders: true;
  }): Promise<{
    headers: Headers;
    response:
      | { status: "pending" }
      | { status: "expired" }
      | ({ status: "approved" } & QrPairingClaimResult);
  }>;
  pollQrPairingDeviceCode(input: {
    body: { deviceCode: string };
  }): Promise<
    | { status: "pending" }
    | { status: "expired" }
    | ({ status: "approved" } & QrPairingClaimResult)
  >;
}

export interface QrPairingOptions {
  /** Override the pairing-code TTL (ms). Defaults to 2 minutes. */
  readonly ttlMs?: number;
}

export function qrPairing(options?: QrPairingOptions) {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

  return {
    id: "qr-pairing",
    endpoints: {
      createQrPairingCode: createAuthEndpoint(
        "/qr-pairing/create",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const session = ctx.context.session;
          const code = generatePairingCode();
          const identifier = `${PENDING_PREFIX}:${await hashCode(code)}`;
          await ctx.context.internalAdapter.createVerificationValue({
            identifier,
            value: JSON.stringify({ userId: session.user.id }),
            expiresAt: new Date(Date.now() + ttlMs),
          });
          return ctx.json({ code, expiresIn: Math.floor(ttlMs / 1000) });
        },
      ),

      claimQrPairingCode: createAuthEndpoint(
        "/qr-pairing/claim",
        { method: "POST", body: claimBodySchema },
        async (ctx) => {
          const hash = await hashCode(ctx.body.code);
          const invalid = () =>
            ctx.error("UNAUTHORIZED", {
              message: "Invalid or expired pairing code",
            });

          const pending = await ctx.context.internalAdapter.findVerificationValue(
            `${PENDING_PREFIX}:${hash}`,
          );
          if (!pending) throw invalid();
          if (pending.expiresAt < new Date()) {
            await ctx.context.internalAdapter.deleteVerificationValue(pending.id);
            throw invalid();
          }

          // Single-use: consume the pending row before minting anything.
          await ctx.context.internalAdapter.deleteVerificationValue(pending.id);
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `${CLAIMED_PREFIX}:${hash}`,
            value: "{}",
            expiresAt: new Date(Date.now() + CLAIMED_MARKER_TTL_MS),
          });

          const parsed = JSON.parse(pending.value) as { userId?: string };
          if (!parsed.userId) throw invalid();

          const user = await ctx.context.internalAdapter.findUserById(
            parsed.userId,
          );
          if (!user) throw invalid();

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            ctx,
          );
          if (!session) {
            throw ctx.error("INTERNAL_SERVER_ERROR", {
              message: "Failed to create session",
            });
          }
          await setSessionCookie(ctx, { session, user });

          return ctx.json({
            token: session.token,
            user: {
              id: user.id,
              email: user.email,
              emailVerified: user.emailVerified,
              name: user.name,
              image: user.image,
              createdAt: user.createdAt,
              updatedAt: user.updatedAt,
            },
          });
        },
      ),

      qrPairingStatus: createAuthEndpoint(
        "/qr-pairing/status",
        {
          method: "POST",
          body: claimBodySchema,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const hash = await hashCode(ctx.body.code);

          const claimed = await ctx.context.internalAdapter.findVerificationValue(
            `${CLAIMED_PREFIX}:${hash}`,
          );
          if (claimed && claimed.expiresAt >= new Date()) {
            return ctx.json({ status: "claimed" as const });
          }

          const pending = await ctx.context.internalAdapter.findVerificationValue(
            `${PENDING_PREFIX}:${hash}`,
          );
          if (pending && pending.expiresAt >= new Date()) {
            return ctx.json({ status: "pending" as const });
          }

          return ctx.json({ status: "expired" as const });
        },
      ),
      // ----- Device-code flow (ForgeGraph-style): mobile displays a typed
      // ----- code, web approves it, mobile polls until a session lands.

      requestQrPairingDeviceCode: createAuthEndpoint(
        "/qr-pairing/request-code",
        { method: "POST", body: z.object({}).optional() },
        async (ctx) => {
          const deviceCode = generatePairingCode();
          const deviceHash = await hashCode(deviceCode);

          // Regenerate on the (unlikely) user-code collision with a live row.
          let userCode = generateUserCode();
          for (let attempt = 0; attempt < 3; attempt++) {
            const existing =
              await ctx.context.internalAdapter.findVerificationValue(
                `${USER_CODE_PREFIX}:${normalizeUserCode(userCode)}`,
              );
            if (!existing || existing.expiresAt < new Date()) break;
            userCode = generateUserCode();
          }

          const expiresAt = new Date(Date.now() + DEVICE_TTL_MS);
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `${DEVICE_PREFIX}:${deviceHash}`,
            value: JSON.stringify({ status: "pending" }),
            expiresAt,
          });
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `${USER_CODE_PREFIX}:${normalizeUserCode(userCode)}`,
            value: JSON.stringify({ deviceHash }),
            expiresAt,
          });

          return ctx.json({
            deviceCode,
            userCode,
            expiresIn: Math.floor(DEVICE_TTL_MS / 1000),
            interval: 3,
          });
        },
      ),

      approveQrPairingDeviceCode: createAuthEndpoint(
        "/qr-pairing/approve",
        { method: "POST", body: approveBodySchema, use: [sessionMiddleware] },
        async (ctx) => {
          const invalid = () =>
            ctx.error("BAD_REQUEST", {
              message: "That code is invalid or has expired.",
            });

          const userRow = await ctx.context.internalAdapter.findVerificationValue(
            `${USER_CODE_PREFIX}:${normalizeUserCode(ctx.body.userCode)}`,
          );
          if (!userRow || userRow.expiresAt < new Date()) throw invalid();

          const { deviceHash } = JSON.parse(userRow.value) as {
            deviceHash?: string;
          };
          if (!deviceHash) throw invalid();

          const deviceRow =
            await ctx.context.internalAdapter.findVerificationValue(
              `${DEVICE_PREFIX}:${deviceHash}`,
            );
          if (!deviceRow || deviceRow.expiresAt < new Date()) throw invalid();

          const state = JSON.parse(deviceRow.value) as { status?: string };
          if (state.status !== "pending") throw invalid();

          // Single-approval: consume the user-code row and flip the device
          // row to approved (delete + recreate — the adapter has no update).
          await ctx.context.internalAdapter.deleteVerificationValue(userRow.id);
          await ctx.context.internalAdapter.deleteVerificationValue(
            deviceRow.id,
          );
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `${DEVICE_PREFIX}:${deviceHash}`,
            value: JSON.stringify({
              status: "approved",
              userId: ctx.context.session.user.id,
            }),
            expiresAt: deviceRow.expiresAt,
          });

          return ctx.json({ status: "approved" as const });
        },
      ),

      pollQrPairingDeviceCode: createAuthEndpoint(
        "/qr-pairing/poll",
        { method: "POST", body: pollBodySchema },
        async (ctx) => {
          const deviceHash = await hashCode(ctx.body.deviceCode);
          const deviceRow =
            await ctx.context.internalAdapter.findVerificationValue(
              `${DEVICE_PREFIX}:${deviceHash}`,
            );
          if (!deviceRow || deviceRow.expiresAt < new Date()) {
            return ctx.json({ status: "expired" as const });
          }

          const state = JSON.parse(deviceRow.value) as {
            status?: string;
            userId?: string;
          };
          if (state.status !== "approved" || !state.userId) {
            return ctx.json({ status: "pending" as const });
          }

          // Single-use: consume before minting the session.
          await ctx.context.internalAdapter.deleteVerificationValue(
            deviceRow.id,
          );

          const user = await ctx.context.internalAdapter.findUserById(
            state.userId,
          );
          if (!user) {
            return ctx.json({ status: "expired" as const });
          }

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            ctx,
          );
          if (!session) {
            throw ctx.error("INTERNAL_SERVER_ERROR", {
              message: "Failed to create session",
            });
          }
          await setSessionCookie(ctx, { session, user });

          return ctx.json({
            status: "approved" as const,
            token: session.token,
            user: {
              id: user.id,
              email: user.email,
              emailVerified: user.emailVerified,
              name: user.name,
              image: user.image,
              createdAt: user.createdAt,
              updatedAt: user.updatedAt,
            },
          });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path.startsWith("/qr-pairing/claim"),
        window: 60,
        max: 10,
      },
      {
        pathMatcher: (path: string) =>
          path.startsWith("/qr-pairing/request-code") ||
          path.startsWith("/qr-pairing/approve"),
        window: 60,
        max: 10,
      },
      {
        pathMatcher: (path: string) => path.startsWith("/qr-pairing/poll"),
        window: 60,
        max: 30,
      },
    ],
  };
}
