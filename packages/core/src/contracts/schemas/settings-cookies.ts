// Wire-format schemas for the settings.cookies.* procedures.
//
// Mirrors shapes from `@bob/api/router/cookies.ts` translated into Effect
// Schema. Cookie values never travel in plaintext on the wire for list/remove;
// only `getForSession` returns decrypted values (scoped to an approved session).
import { Schema } from "effect";

// --- Enums ------------------------------------------------------------------

export const CookieSameSiteEnum = Schema.Literals(["Strict", "Lax", "None"]);
export type CookieSameSite = typeof CookieSameSiteEnum.Type;

// --- Cookie input (for import) -----------------------------------------------

export const CookieInputSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.optional(Schema.String),
  expires: Schema.optional(Schema.NullOr(Schema.Number)),
  secure: Schema.optional(Schema.Boolean),
  httpOnly: Schema.optional(Schema.Boolean),
  sameSite: Schema.optional(CookieSameSiteEnum),
});
export type CookieInputWire = typeof CookieInputSchema.Type;

// --- Cookie domain listing ---------------------------------------------------

export const CookieDomainSchema = Schema.Struct({
  domain: Schema.String,
  count: Schema.Number,
  source: Schema.NullOr(Schema.String),
  lastUpdated: Schema.NullOr(Schema.DateTimeUtc),
});
export type CookieDomainWire = typeof CookieDomainSchema.Type;

// --- Decrypted cookie (returned by getForSession) ----------------------------

export const CookieSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.String,
  expires: Schema.Number,
  secure: Schema.Boolean,
  httpOnly: Schema.Boolean,
  sameSite: CookieSameSiteEnum,
});
export type CookieWire = typeof CookieSchema.Type;
