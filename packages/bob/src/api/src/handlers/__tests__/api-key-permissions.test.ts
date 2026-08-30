/**
 * `api_keys.permissions` is an unconstrained JSON column
 * (`t.json().$type<string[]>()`), so nothing has ever stopped a writer putting
 * a different shape in it. Production holds at least three:
 *
 *   ["admin"]                 — the documented shape
 *   ["read","write","daemon"] — a scope the RPC contract never listed
 *   {"scopes":["*"]}          — not an array at all
 *
 * The RPC success schema declared a literal union of
 * read|write|delete|admin, so encoding `settings.listApiKeys` failed on the
 * real rows and the settings page rendered blank (2026-08-30). Normalise on
 * read so one legacy row cannot take down the whole list.
 */
import { describe, expect, it } from "vitest";

import { normalizeApiKeyPermissions } from "../api-key-permissions.js";

describe("normalizeApiKeyPermissions", () => {
  it("passes a plain string array through", () => {
    expect(normalizeApiKeyPermissions(["read", "write"])).toEqual(["read", "write"]);
  });

  it("keeps scopes the contract never listed rather than dropping them", () => {
    // Silently dropping "daemon" would misreport what a key can actually do.
    expect(normalizeApiKeyPermissions(["read", "write", "daemon"])).toEqual([
      "read",
      "write",
      "daemon",
    ]);
  });

  it("unwraps the legacy {scopes:[...]} object", () => {
    expect(normalizeApiKeyPermissions({ scopes: ["*"] })).toEqual(["*"]);
  });

  it("returns an empty list for null or a shape it cannot read", () => {
    // A single unreadable row must not fail the whole listing.
    expect(normalizeApiKeyPermissions(null)).toEqual([]);
    expect(normalizeApiKeyPermissions(42)).toEqual([]);
    expect(normalizeApiKeyPermissions({ nope: true })).toEqual([]);
  });

  it("coerces non-string members to strings", () => {
    expect(normalizeApiKeyPermissions(["read", 7])).toEqual(["read", "7"]);
  });
});
