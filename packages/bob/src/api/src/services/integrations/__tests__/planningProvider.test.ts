import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@bob/db/client";

// `resolvePlanningProvider` takes a real drizzle `Db`, but this mock is a
// self-referential "everything chains back to itself, then thenable
// resolves like a query result" fake that doesn't (and can't reasonably)
// implement drizzle's full fluent builder surface. Typed here as its own
// honest shape and cast `as unknown as Db` only where the real interface
// is actually required (the resolvePlanningProvider call sites) — plain
// arrow functions (not `mockReturnThis()`, which needs an unbound `this`)
// so no unbound-method concerns either.
interface MockDb {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  then: ReturnType<typeof vi.fn<(cb: (rows: unknown[]) => unknown) => Promise<unknown>>>;
}

vi.mock("@bob/db", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("@bob/db/schema", () => ({
  workspaceIntegrations: {
    workspaceId: "workspaceIntegrations.workspaceId",
    provider: "workspaceIntegrations.provider",
    enabled: "workspaceIntegrations.enabled",
  },
}));

describe("resolvePlanningProvider", () => {
  let resolvePlanningProvider: typeof import("../planningProvider.js").resolvePlanningProvider;
  let PlanningProviderError: typeof import("../planningProvider.js").PlanningProviderError;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-mock after resetModules
    vi.doMock("@bob/db", () => ({
      and: vi.fn((...args: unknown[]) => args),
      eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
    }));

    vi.doMock("@bob/db/schema", () => ({
      workspaceIntegrations: {
        workspaceId: "workspaceIntegrations.workspaceId",
        provider: "workspaceIntegrations.provider",
        enabled: "workspaceIntegrations.enabled",
      },
    }));

    const mod = await import("../planningProvider.js");
    resolvePlanningProvider = mod.resolvePlanningProvider;
    PlanningProviderError = mod.PlanningProviderError;
  });

  function createMockDb(rows: unknown[] = []): MockDb {
    const mock = {} as MockDb;
    mock.select = vi.fn(() => mock);
    mock.from = vi.fn(() => mock);
    mock.where = vi.fn(() => mock);
    mock.then = vi.fn((cb: (rows: unknown[]) => unknown) =>
      Promise.resolve(cb(rows)),
    );
    return mock;
  }

  it("returns InternalPlanningProvider when planningProvider is 'internal'", async () => {
    const db = createMockDb();
    const project = { planningProvider: "internal", linearProjectId: null };

    const provider = await resolvePlanningProvider(db as unknown as Db, project, "ws-1");

    expect(provider).toBeDefined();
    expect(typeof provider.createTask).toBe("function");
    expect(typeof provider.getTask).toBe("function");
    // Verify it's the internal provider by checking it doesn't require linear-specific setup
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns LinearPlanningProvider when planningProvider is 'linear' and config exists", async () => {
    const db = createMockDb([
      {
        id: "int-1",
        workspaceId: "ws-1",
        provider: "linear",
        enabled: true,
        apiKey: "lin_test_key",
        linearTeamId: "team-1",
      },
    ]);

    const project = { planningProvider: "linear", linearProjectId: "proj-1" };

    const provider = await resolvePlanningProvider(db as unknown as Db, project, "ws-1");

    expect(provider).toBeDefined();
    expect(typeof provider.createTask).toBe("function");
    expect(db.select).toHaveBeenCalled();
  });

  it("throws PlanningProviderError when linear config is missing (no integration row)", async () => {
    const db = createMockDb([]);
    const project = { planningProvider: "linear", linearProjectId: "proj-1" };

    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toMatchObject({
      code: "INTEGRATION_NOT_CONFIGURED",
      retriable: false,
    });
  });

  it("throws PlanningProviderError when API key is missing", async () => {
    const db = createMockDb([
      {
        id: "int-1",
        workspaceId: "ws-1",
        provider: "linear",
        enabled: true,
        apiKey: null,
        linearTeamId: "team-1",
      },
    ]);

    const project = { planningProvider: "linear", linearProjectId: "proj-1" };

    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toMatchObject({
      code: "API_KEY_MISSING",
      retriable: false,
    });
  });

  it("throws PlanningProviderError when team ID is missing", async () => {
    const db = createMockDb([
      {
        id: "int-1",
        workspaceId: "ws-1",
        provider: "linear",
        enabled: true,
        apiKey: "lin_test_key",
        linearTeamId: null,
      },
    ]);

    const project = { planningProvider: "linear", linearProjectId: "proj-1" };

    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toMatchObject({
      code: "TEAM_ID_MISSING",
      retriable: false,
    });
  });

  it("throws PlanningProviderError when linearProjectId is missing", async () => {
    const db = createMockDb([
      {
        id: "int-1",
        workspaceId: "ws-1",
        provider: "linear",
        enabled: true,
        apiKey: "lin_test_key",
        linearTeamId: "team-1",
      },
    ]);

    const project = { planningProvider: "linear", linearProjectId: null };

    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toMatchObject({
      code: "PROJECT_NOT_MAPPED",
      retriable: false,
    });
  });

  it("throws PlanningProviderError for unknown provider type", async () => {
    const db = createMockDb();
    const project = { planningProvider: "jira", linearProjectId: null };

    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db as unknown as Db, project, "ws-1")).rejects.toMatchObject({
      code: "UNKNOWN_PROVIDER",
      retriable: false,
    });
  });
});
