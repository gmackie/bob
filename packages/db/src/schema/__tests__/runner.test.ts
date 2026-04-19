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

