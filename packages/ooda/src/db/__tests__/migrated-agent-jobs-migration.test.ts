import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BACKFILL_SQL } from "../migrations/personal-os-v1";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../drizzle/0020_reconcile_migrated_agent_jobs.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("migrated agent-job reconciliation", () => {
  it("never imports a live-looking job without a runnable lease", () => {
    expect(BACKFILL_SQL).toMatch(/when 'running' then 'failed'/);
    expect(BACKFILL_SQL).toContain("legacy-session-reconciliation:");
    expect(BACKFILL_SQL).toContain("Migration could not adopt a live runner process");
  });

  it("repairs only migrated running jobs that were never leased", () => {
    expect(migration).toContain(
      "lock table ooda.agent_jobs, ooda.agent_job_events in share row exclusive mode",
    );
    expect(migration).toMatch(
      /aj\.result #>> '\{migration,source\}'\) = 'runner_session'/,
    );
    expect(migration).toContain("aj.status = 'running'");
    expect(migration).toContain("aj.lease_expires_at is null");
    expect(migration).toContain("aj.claimed_by is null");
    expect(migration).not.toMatch(/delete\s+from/i);
    expect(migration).not.toMatch(/drop\s+(table|schema)/i);
  });

  it("records one terminal event and synchronizes the canonical sequence", () => {
    expect(migration).toContain("insert into ooda.agent_job_events");
    expect(migration).toContain("reconcile-migrated-runner-session:");
    expect(migration).toContain("last_sequence");
    expect(migration).toContain("on conflict (agent_job_id, idempotency_key) do nothing");
  });
});
