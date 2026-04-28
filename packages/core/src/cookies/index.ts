// @gmacko/cookies — Phase 6L peripheral package stub.
//
// Public surface:
//   - Pure cookie helpers: `getCookie`, `setCookie`, `deleteCookie`,
//     `parseCookieHeader`, `serializeCookie`.
//   - Type: `CookieOptions`.
//   - Tagged error: `CookiesNotImplementedError`.
//
// Unlike the other Phase 6L peripherals this package exposes pure functions
// rather than an Effect service — the real implementation will delegate to
// Next.js's `next/headers` `cookies()` API or to a manual header parser.
// All stub functions throw `CookiesNotImplementedError` on call.
import { Schema } from "effect";

export interface CookieOptions {
  readonly maxAge?: number;
  readonly expires?: Date;
  readonly path?: string;
  readonly domain?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly sameSite?: "strict" | "lax" | "none";
}

export class CookiesNotImplementedError extends Schema.TaggedErrorClass<CookiesNotImplementedError>()(
  "CookiesNotImplementedError",
  {
    reason: Schema.String,
    name: Schema.optional(Schema.String),
  },
) {}

const reason = "@gmacko/cookies: deferred to Phase 7 (Bob migration)";

/**
 * Get a cookie value by name. Real implementation delegates to next/headers
 * `cookies()` API. Stub throws `CookiesNotImplementedError`.
 */
export function getCookie(name: string): string | undefined {
  throw new CookiesNotImplementedError({ reason, name });
}

/**
 * Set a cookie via the response. Real implementation calls `cookies().set(...)`
 * inside a Next.js Server Action / Route Handler. Stub throws
 * `CookiesNotImplementedError`.
 */
export function setCookie(
  name: string,
  _value: string,
  _options?: CookieOptions,
): void {
  throw new CookiesNotImplementedError({ reason, name });
}

/**
 * Delete a cookie. Real implementation calls `cookies().delete(name, options)`.
 * Stub throws `CookiesNotImplementedError`.
 */
export function deleteCookie(
  name: string,
  _options?: Pick<CookieOptions, "path" | "domain">,
): void {
  throw new CookiesNotImplementedError({ reason, name });
}

/** Parse a `Cookie:` request header value into a name → value map. */
export function parseCookieHeader(header: string): Record<string, string> {
  throw new CookiesNotImplementedError({
    reason: `${reason} — parse "${header.slice(0, 32)}..."`,
  });
}

/** Serialize a single cookie name+value+options into a `Set-Cookie` value. */
export function serializeCookie(
  name: string,
  _value: string,
  _options?: CookieOptions,
): string {
  throw new CookiesNotImplementedError({ reason, name });
}

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoCookiesPhase = "6l" as const;
