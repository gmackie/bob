// Stateless HMAC-signed opaque tokens for runner session auth.
//
// Token format:
//   payload   = base64url(JSON.stringify({deviceId, tenantId, issuedAt, expiresAt}))
//   signature = base64url(HMAC-SHA256(runnerSessionKey, payload))
//   token     = `${payload}.${signature}`
//
// `runnerSessionKey` is derived from `GMACKO_SECRET_ENCRYPTION_KEY` via
// `HMAC(master, "runner-session")` — the same envelope pattern used by
// `@gmacko/secrets/crypt.ts` for per-row keys. Deriving a sub-key (instead
// of using the master key directly) keeps runner-session tokens isolated
// from other uses of the master key, so a compromise of one domain's
// signatures doesn't leak the master secret.
//
// Stateless by design: there is NO `runner_sessions` DB table. Validation
// = HMAC check + expiry check. TTL defaults to 1h; runners refresh by
// re-registering (6G has no separate refresh RPC).
import { createHmac } from "node:crypto";
import { Effect, Layer, Schema, ServiceMap } from "effect";

const ENV_VAR_NAME = "GMACKO_SECRET_ENCRYPTION_KEY" as const;
const MASTER_KEY_MIN_LENGTH = 32;

function getRunnerSessionKey(): Buffer {
  const master = process.env[ENV_VAR_NAME];
  if (!master) {
    throw new Error(
      `${ENV_VAR_NAME} environment variable is required for runner sessions`,
    );
  }
  if (master.length < MASTER_KEY_MIN_LENGTH) {
    throw new Error(
      `${ENV_VAR_NAME} must be at least ${MASTER_KEY_MIN_LENGTH} characters`,
    );
  }
  // Sub-key = HMAC(first-32-bytes-of-master, "runner-session"). Mirrors
  // the `deriveRowKey` pattern in `@gmacko/secrets/crypt.ts`.
  return createHmac(
    "sha256",
    Buffer.from(master.slice(0, MASTER_KEY_MIN_LENGTH), "utf8"),
  )
    .update("runner-session")
    .digest();
}

/**
 * Reason tag surfaced to callers. `malformed` = structure invalid (wrong
 * dot count, non-JSON payload, missing fields); `signature` = HMAC mismatch;
 * `expired` = past `expiresAt`.
 */
export class InvalidRunnerSessionError extends Schema.TaggedErrorClass<InvalidRunnerSessionError>()(
  "InvalidRunnerSessionError",
  { reason: Schema.Literals(["malformed", "signature", "expired"]) },
) {}

export interface RunnerSessionClaims {
  readonly deviceId: string;
  readonly tenantId: string;
}

export interface MintResult {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface MintInput {
  readonly deviceId: string;
  readonly tenantId: string;
  /** Defaults to 1 hour. Negative values produce an already-expired token (useful for tests). */
  readonly ttlMs?: number;
}

export interface RunnerSessionsShape {
  readonly mint: (input: MintInput) => Effect.Effect<MintResult>;
  readonly validate: (
    token: string,
  ) => Effect.Effect<RunnerSessionClaims, InvalidRunnerSessionError>;
}

export class RunnerSessions extends ServiceMap.Service<
  RunnerSessions,
  RunnerSessionsShape
>()("@gmacko/auth/RunnerSessions") {}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

const b64url = (b: Buffer): string => b.toString("base64url");
const b64urlToBuf = (s: string): Buffer => Buffer.from(s, "base64url");

/**
 * Layer constructs the HMAC sub-key once at build time by reading the env
 * var synchronously. If the env var is missing or too short, Layer.effect
 * will reject with the thrown error — callers see it in the Effect error
 * channel when they first touch the service.
 *
 * No `GmackoDb` dependency: the token is fully self-describing, so the
 * Layer has `never` as its requirement.
 */
export const layerRunnerSessions: Layer.Layer<RunnerSessions> = Layer.effect(
  RunnerSessions,
)(
  Effect.sync(() => {
    const key = getRunnerSessionKey();

    const mint: RunnerSessionsShape["mint"] = ({ deviceId, tenantId, ttlMs }) =>
      Effect.sync(() => {
        const issuedAt = Date.now();
        const expiresAt = new Date(issuedAt + (ttlMs ?? DEFAULT_TTL_MS));
        const payload = {
          deviceId,
          tenantId,
          issuedAt,
          expiresAt: expiresAt.toISOString(),
        };
        const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
        const signature = b64url(
          createHmac("sha256", key).update(payloadB64).digest(),
        );
        return { token: `${payloadB64}.${signature}`, expiresAt };
      });

    const validate: RunnerSessionsShape["validate"] = (token) =>
      Effect.gen(function* () {
        const parts = token.split(".");
        if (parts.length !== 2) {
          return yield* Effect.fail(
            new InvalidRunnerSessionError({ reason: "malformed" }),
          );
        }
        const [payloadB64, signature] = parts as [string, string];
        if (payloadB64.length === 0 || signature.length === 0) {
          return yield* Effect.fail(
            new InvalidRunnerSessionError({ reason: "malformed" }),
          );
        }
        const expected = b64url(
          createHmac("sha256", key).update(payloadB64).digest(),
        );
        // HMAC-SHA256 signatures are a fixed 43-char base64url string so a
        // plain string compare is acceptable here. Upgrade to
        // `crypto.timingSafeEqual` on equal-length Buffers if the signature
        // comparison ever becomes a timing-attack target.
        if (expected !== signature) {
          return yield* Effect.fail(
            new InvalidRunnerSessionError({ reason: "signature" }),
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(b64urlToBuf(payloadB64).toString("utf8"));
        } catch {
          return yield* Effect.fail(
            new InvalidRunnerSessionError({ reason: "malformed" }),
          );
        }
        const claims = parsed as {
          deviceId?: unknown;
          tenantId?: unknown;
          expiresAt?: unknown;
        };
        if (
          typeof claims.deviceId !== "string" ||
          typeof claims.tenantId !== "string" ||
          typeof claims.expiresAt !== "string"
        ) {
          return yield* Effect.fail(
            new InvalidRunnerSessionError({ reason: "malformed" }),
          );
        }
        const expiresAtMs = Date.parse(claims.expiresAt);
        if (Number.isNaN(expiresAtMs)) {
          return yield* Effect.fail(
            new InvalidRunnerSessionError({ reason: "malformed" }),
          );
        }
        if (Date.now() > expiresAtMs) {
          return yield* Effect.fail(
            new InvalidRunnerSessionError({ reason: "expired" }),
          );
        }
        return { deviceId: claims.deviceId, tenantId: claims.tenantId };
      });

    return { mint, validate } satisfies RunnerSessionsShape;
  }),
);
