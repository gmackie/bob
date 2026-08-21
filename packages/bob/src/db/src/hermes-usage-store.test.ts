import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PgliteDbHandle } from "./client-pglite.js";
import type { Db } from "./client.js";
import { makePgliteDb } from "./client-pglite.js";
import { createHermesUsageStore } from "./hermes-usage-store.js";

describe("Hermes usage store", () => {
  let handle: PgliteDbHandle;

  beforeAll(async () => {
    handle = await makePgliteDb({ dataDir: ":memory:" });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("persists categorized usage replay-safely without content fields", async () => {
    const store = createHermesUsageStore(handle.db as unknown as Db);
    const event = {
      recordId: `sha256:${"a".repeat(64)}`,
      requestIdDigest: `sha256:${"b".repeat(64)}`,
      actorUserIdDigest: `sha256:${"c".repeat(64)}`,
      intent: "capture",
      channel: "telegram",
      owner: "ooda",
      riskClass: "R1",
      outcome: "success",
      durationBucket: "1-10s",
      evidence: "complete",
      observedAt: "2026-08-21T13:30:02Z",
    } as const;

    await store.record(event);
    await store.record(event);

    const rows = await handle.client.query("select * from hermes_usage_events");
    expect(rows.rows).toHaveLength(1);
    expect(JSON.stringify(rows.rows)).not.toContain("lab workflow");
    expect(Object.keys(rows.rows[0] as object).sort()).toEqual([
      "actor_user_id_digest",
      "channel",
      "duration_bucket",
      "evidence",
      "intent",
      "observed_at",
      "outcome",
      "owner",
      "record_id",
      "request_id_digest",
      "risk_class",
    ]);
  });
});
