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
/** Pairing codes live 2 minutes — long enough to scan, short enough to leak safely. */
const DEFAULT_TTL_MS = 2 * 60 * 1000;
/** How long the "claimed" marker sticks around for the web poller. */
const CLAIMED_MARKER_TTL_MS = 5 * 60 * 1000;

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
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path.startsWith("/qr-pairing/claim"),
        window: 60,
        max: 10,
      },
    ],
  };
}
