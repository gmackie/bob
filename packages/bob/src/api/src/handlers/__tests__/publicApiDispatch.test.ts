import { afterEach, describe, expect, it } from "vitest";

import { publicApiDispatchExecution } from "../publicApi.js";

// The executable-dispatch endpoint is a security-sensitive expansion of what a
// public API key can do (it RUNS an agent, vs the record-only createRun). It is
// gated behind BOB_OODA_DISPATCH_ENABLED and must be dark unless that flag is
// exactly "true". These tests pin that gate — the rest of the handler (tenant
// scoping, session creation) needs a live DB and is exercised in integration.
describe("publicApiDispatchExecution — security gate", () => {
  const original = process.env.BOB_OODA_DISPATCH_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.BOB_OODA_DISPATCH_ENABLED;
    else process.env.BOB_OODA_DISPATCH_ENABLED = original;
  });

  // The gate check runs before any ctx.db access, so a bare ctx is fine.
  const ctx = { db: {} as never, userId: "user-1" };
  const input = {
    workspaceId: "00000000-0000-0000-0000-000000000000",
    title: "do a thing",
  };

  it("is FORBIDDEN when the flag is unset (dark by default)", async () => {
    delete process.env.BOB_OODA_DISPATCH_ENABLED;
    await expect(publicApiDispatchExecution(ctx, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("is FORBIDDEN when the flag is set to anything other than exactly 'true'", async () => {
    for (const val of ["1", "false", "TRUE", "yes", ""]) {
      process.env.BOB_OODA_DISPATCH_ENABLED = val;
      await expect(publicApiDispatchExecution(ctx, input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });

  it("passes the gate when enabled (then fails later, not with FORBIDDEN)", async () => {
    process.env.BOB_OODA_DISPATCH_ENABLED = "true";
    // With the flag on it proceeds past the gate and blows up on the bare db —
    // proving the toggle actually opens the gate rather than short-circuiting.
    await expect(
      publicApiDispatchExecution(ctx, input),
    ).rejects.not.toMatchObject({ code: "FORBIDDEN" });
  });
});
