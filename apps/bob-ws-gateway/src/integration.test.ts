import { describe, it } from "vitest";

// Real end-to-end integration tests against Postgres will be added in Phase 3
// when we have a test database set up. For now we rely on the unit tests in
// relay.test.ts, nudge.test.ts, auth.test.ts, persistence.test.ts, and protocol.test.ts.
describe.skip("ws-gateway integration", () => {
  it("browser subscribes and receives daemon events end-to-end", async () => {
    // TODO(phase-3): implement against test Postgres
  });
});
