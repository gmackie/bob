import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import {
  runnerDevices,
  runnerCapabilities,
  taskRuns,
  taskRunEvents,
} from "../runner.js";
import { tenants } from "../tenancy.js";

describe("@gmacko/db runner schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
    // Apply raw DDL — per-test until Task 11 wires drizzle-kit migrations
    // into the shared helper. DDL includes prerequisites (users, tenants,
    // tenant_members) because the runner tables reference tenants. Declares
    // the three runner pgEnums (runner_device_status, task_run_status,
    // task_run_event_type) — these type names are distinct from every other
    // enum used by the auth/tenancy/secrets/sessions schemas.
    await ctx.pglite.exec(DDL);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it("runner_devices: register a device + query by id; default status is offline", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Acme", slug: "acme" })
      .returning();

    const [device] = await ctx.db
      .insert(runnerDevices)
      .values({
        tenantId: tenant!.id,
        hostname: "worker-01.lab.internal",
        metadata: { os: "linux", runnerVersion: "0.1.0" },
      })
      .returning();

    const found = await ctx.db.query.runnerDevices.findFirst({
      where: eq(runnerDevices.id, device!.id),
    });
    expect(found).toBeDefined();
    expect(found?.tenantId).toBe(tenant!.id);
    expect(found?.hostname).toBe("worker-01.lab.internal");
    expect(found?.status).toBe("offline");
    expect(found?.lastHeartbeatAt).toBeNull();
    expect(found?.metadata).toEqual({ os: "linux", runnerVersion: "0.1.0" });
  });

  it("runner_capabilities: add capabilities + query by device; (deviceId, capability) uniqueness", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Cap Co", slug: "cap" })
      .returning();
    const [device] = await ctx.db
      .insert(runnerDevices)
      .values({
        tenantId: tenant!.id,
        hostname: "worker-cap.lab",
      })
      .returning();

    await ctx.db.insert(runnerCapabilities).values([
      {
        deviceId: device!.id,
        capability: "can_codex",
        metadata: { model: "gpt-5" },
      },
      {
        deviceId: device!.id,
        capability: "can_claude",
        metadata: { model: "claude-opus-4-7" },
      },
      {
        deviceId: device!.id,
        capability: "has_vault_write",
      },
    ]);

    const caps = await ctx.db.query.runnerCapabilities.findMany({
      where: eq(runnerCapabilities.deviceId, device!.id),
    });
    expect(caps).toHaveLength(3);
    const names = caps.map((c) => c.capability).sort();
    expect(names).toEqual(["can_claude", "can_codex", "has_vault_write"]);
    const codex = caps.find((c) => c.capability === "can_codex");
    expect(codex?.metadata).toEqual({ model: "gpt-5" });

    // Duplicate (deviceId, capability) must fail
    await expect(
      ctx.db.insert(runnerCapabilities).values({
        deviceId: device!.id,
        capability: "can_codex",
      }),
    ).rejects.toThrow();
  });

  it("task_runs: create with capabilitiesRequired array; round-trip the text[] column", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Runs Inc", slug: "runs" })
      .returning();

    const [run] = await ctx.db
      .insert(taskRuns)
      .values({
        tenantId: tenant!.id,
        capabilitiesRequired: ["can_codex", "has_vault_write"],
        input: { prompt: "refactor this module", repo: "acme/app" },
      })
      .returning();

    const found = await ctx.db.query.taskRuns.findFirst({
      where: eq(taskRuns.id, run!.id),
    });
    expect(found).toBeDefined();
    expect(found?.status).toBe("pending");
    expect(found?.capabilitiesRequired).toEqual([
      "can_codex",
      "has_vault_write",
    ]);
    expect(found?.claimedByDeviceId).toBeNull();
    expect(found?.claimedAt).toBeNull();
    expect(found?.startedAt).toBeNull();
    expect(found?.completedAt).toBeNull();
    expect(found?.result).toBeNull();
    expect(found?.errorMessage).toBeNull();
    expect(found?.input).toEqual({
      prompt: "refactor this module",
      repo: "acme/app",
    });

    // An empty-requirements run must round-trip as an empty array
    const [empty] = await ctx.db
      .insert(taskRuns)
      .values({
        tenantId: tenant!.id,
      })
      .returning();
    const emptyFound = await ctx.db.query.taskRuns.findFirst({
      where: eq(taskRuns.id, empty!.id),
    });
    expect(emptyFound?.capabilitiesRequired).toEqual([]);
  });

  it("task_runs: claim by device then SET NULL on device delete", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Claim Co", slug: "claim" })
      .returning();
    const [device] = await ctx.db
      .insert(runnerDevices)
      .values({
        tenantId: tenant!.id,
        hostname: "claimer.lab",
        status: "idle",
      })
      .returning();
    const [run] = await ctx.db
      .insert(taskRuns)
      .values({
        tenantId: tenant!.id,
        capabilitiesRequired: ["can_claude"],
      })
      .returning();

    const claimedAt = new Date();
    await ctx.db
      .update(taskRuns)
      .set({
        status: "claimed",
        claimedByDeviceId: device!.id,
        claimedAt,
      })
      .where(eq(taskRuns.id, run!.id));

    const claimed = await ctx.db.query.taskRuns.findFirst({
      where: eq(taskRuns.id, run!.id),
    });
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.claimedByDeviceId).toBe(device!.id);
    expect(claimed?.claimedAt).toBeInstanceOf(Date);

    // Deleting the device should SET NULL on claimedByDeviceId, not cascade
    await ctx.db
      .delete(runnerDevices)
      .where(eq(runnerDevices.id, device!.id));
    const orphan = await ctx.db.query.taskRuns.findFirst({
      where: eq(taskRuns.id, run!.id),
    });
    expect(orphan).toBeDefined();
    expect(orphan?.claimedByDeviceId).toBeNull();
    // Other claim fields remain — the runner protocol preserves history
    expect(orphan?.status).toBe("claimed");
  });

  it("task_run_events: append with sequential seq, query in order, uniqueness on (runId, seq)", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Events Ltd", slug: "events" })
      .returning();
    const [run] = await ctx.db
      .insert(taskRuns)
      .values({
        tenantId: tenant!.id,
      })
      .returning();

    await ctx.db.insert(taskRunEvents).values([
      {
        runId: run!.id,
        seq: 1,
        type: "status_change",
        payload: { from: "pending", to: "claimed" },
      },
      {
        runId: run!.id,
        seq: 2,
        type: "stdout",
        payload: { line: "starting work" },
      },
      {
        runId: run!.id,
        seq: 3,
        type: "tool_call",
        payload: { name: "read_file", args: { path: "/etc/hosts" } },
      },
      {
        runId: run!.id,
        seq: 4,
        type: "metric",
        payload: { name: "cpu_pct", value: 42.5 },
      },
    ]);

    const events = await ctx.db.query.taskRunEvents.findMany({
      where: eq(taskRunEvents.runId, run!.id),
      orderBy: [asc(taskRunEvents.seq)],
    });
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(events.map((e) => e.type)).toEqual([
      "status_change",
      "stdout",
      "tool_call",
      "metric",
    ]);
    expect(events[2]?.payload).toEqual({
      name: "read_file",
      args: { path: "/etc/hosts" },
    });

    // Duplicate (runId, seq) must fail
    await expect(
      ctx.db.insert(taskRunEvents).values({
        runId: run!.id,
        seq: 2,
        type: "stderr",
        payload: { line: "collision" },
      }),
    ).rejects.toThrow();
  });

  it("task_run_events: cascade on task_run delete", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Cascade Co", slug: "cascade" })
      .returning();
    const [run] = await ctx.db
      .insert(taskRuns)
      .values({
        tenantId: tenant!.id,
      })
      .returning();

    await ctx.db.insert(taskRunEvents).values([
      { runId: run!.id, seq: 1, type: "stdout", payload: { line: "a" } },
      { runId: run!.id, seq: 2, type: "stdout", payload: { line: "b" } },
    ]);

    await ctx.db.delete(taskRuns).where(eq(taskRuns.id, run!.id));

    const remaining = await ctx.db.query.taskRunEvents.findMany();
    expect(remaining).toHaveLength(0);
  });
});

// Raw DDL — applied per-test because drizzle-kit push infrastructure comes
// later (Task 11). This block is replaced with applyTestMigrations() after
// Task 11. Includes users + tenants + tenant_members because the runner
// tables reference tenants. Declares the three runner pgEnums distinctly
// from session_status so no Postgres type collision occurs.
const DDL = `
CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TYPE tenant_role AS ENUM ('owner', 'admin', 'member');
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(128) NOT NULL,
  slug varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role tenant_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_members_tenant_user_unique UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_members_tenant_id_idx ON tenant_members(tenant_id);
CREATE INDEX tenant_members_user_id_idx ON tenant_members(user_id);
CREATE TYPE runner_device_status AS ENUM ('idle', 'busy', 'draining', 'offline');
CREATE TYPE task_run_status AS ENUM ('pending', 'claimed', 'running', 'completed', 'failed', 'canceled');
CREATE TYPE task_run_event_type AS ENUM ('status_change', 'stdout', 'stderr', 'tool_call', 'tool_result', 'error', 'metric');
CREATE TABLE runner_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hostname varchar(256) NOT NULL,
  status runner_device_status NOT NULL DEFAULT 'offline',
  last_heartbeat_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runner_devices_tenant_id_idx ON runner_devices(tenant_id);
CREATE INDEX runner_devices_status_idx ON runner_devices(status);
CREATE TABLE runner_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES runner_devices(id) ON DELETE CASCADE,
  capability varchar(128) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runner_capabilities_device_capability_unique UNIQUE (device_id, capability)
);
CREATE INDEX runner_capabilities_capability_idx ON runner_capabilities(capability);
CREATE TABLE task_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status task_run_status NOT NULL DEFAULT 'pending',
  capabilities_required text[] NOT NULL DEFAULT '{}'::text[],
  claimed_by_device_id uuid REFERENCES runner_devices(id) ON DELETE SET NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error_message text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_runs_tenant_id_idx ON task_runs(tenant_id);
CREATE INDEX task_runs_status_idx ON task_runs(status);
CREATE INDEX task_runs_claimed_by_device_id_idx ON task_runs(claimed_by_device_id);
CREATE TABLE task_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  type task_run_event_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_run_events_run_seq_unique UNIQUE (run_id, seq)
);
CREATE INDEX task_run_events_run_id_idx ON task_run_events(run_id);
`;
