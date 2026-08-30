/**
 * `api_keys.permissions` is an unconstrained JSON column, and production holds
 * more than one shape: `["admin"]`, `["read","write","daemon"]`, and the legacy
 * `{"scopes":["*"]}`. Normalise on read so one odd row cannot fail the encode
 * for the whole list — which is what blanked the settings page on 2026-08-30.
 *
 * Unrecognised scopes are KEPT, not filtered: dropping "daemon" would tell the
 * operator a key is narrower than it really is.
 */
export function normalizeApiKeyPermissions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === "string" ? entry : String(entry)));
  }
  if (value && typeof value === "object" && "scopes" in value) {
    const scopes = (value as { scopes: unknown }).scopes;
    if (Array.isArray(scopes)) {
      return scopes.map((entry) => (typeof entry === "string" ? entry : String(entry)));
    }
  }
  return [];
}
