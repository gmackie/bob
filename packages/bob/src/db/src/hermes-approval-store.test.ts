import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PgliteDbHandle } from "./client-pglite.js";
import type { Db } from "./client.js";
import { makePgliteDb } from "./client-pglite.js";
import { createHermesApprovalLedger } from "./hermes-approval-store.js";

describe("Hermes approval ledger", () => {
  let handle: PgliteDbHandle;

  beforeAll(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:" });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("durably consumes an approval once across concurrent callers", async () => {
    const ledger = createHermesApprovalLedger(handle.db as unknown as Db);
    const consumption = {
      approvalId: "approval-42",
      proposalId: "proposal-42",
      owner: "bob",
      scopeDigest: `sha256:${"a".repeat(64)}`,
      executionId: "execution-42",
      idempotencyKey: "hermes:work:42",
      consumedAt: "2026-08-21T13:02:00Z",
      expiresAt: "2026-08-21T13:15:00Z",
    } as const;

    const attempts = await Promise.allSettled([
      ledger.consume(consumption),
      ledger.consume(consumption),
    ]);

    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      createHermesApprovalLedger(handle.db as unknown as Db).find(
        consumption.approvalId,
      ),
    ).resolves.toEqual(consumption);
  });
});
