/**
 * Runtime env access for `@bob/auth`'s internal request-time logic
 * (currently just the auth-bypass path in `context.ts`).
 *
 * Deliberately NOT a `t3-oss/env-core` `createEnv()` snapshot like the
 * package-root `env.ts` (which backs `authEnv()` for downstream apps):
 * that API parses `process.env` once, eagerly, at call time. These four
 * vars are read per-request (auth-bypass is env-var-gated at runtime, not
 * boot time) and are exercised by tests that mutate `process.env` directly
 * between cases (see `src/__tests__/context.test.ts`), so a one-shot parsed
 * snapshot would go stale. Plain getters stay live against `process.env` on
 * every access, which is what both production request-handling and the
 * tests actually need.
 *
 * This file matches the repo's `**\/env.ts` eslint ignore glob, so it's
 * exempt from `no-restricted-properties`/`no-restricted-imports` — it's the
 * validated boundary the rule wants other modules to import from.
 */

function readFlag(name: string): boolean {
  return process.env[name] === "true";
}

function readTrimmedOrNull(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export const env = {
  get BOB_AUTH_BYPASS(): boolean {
    return readFlag("BOB_AUTH_BYPASS");
  },
  get BOB_AUTH_BYPASS_TOKEN(): string | null {
    return readTrimmedOrNull("BOB_AUTH_BYPASS_TOKEN");
  },
  get BOB_AUTH_BYPASS_USER_ID(): string | null {
    return readTrimmedOrNull("BOB_AUTH_BYPASS_USER_ID");
  },
  get REQUIRE_AUTH(): boolean {
    return readFlag("REQUIRE_AUTH");
  },
};
