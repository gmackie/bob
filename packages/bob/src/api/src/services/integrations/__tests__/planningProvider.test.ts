import { beforeEach, describe, expect, it, vi } from "vitest";

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

  function createMockDb(rows: unknown[] = []) {
    const mock: any = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb(rows)),
      ),
    };
    return mock;
  }

  it("returns InternalPlanningProvider when planningProvider is 'internal'", async () => {
    const db = createMockDb();
    const project = { planningProvider: "internal", linearProjectId: null };

    const provider = await resolvePlanningProvider(db, project, "ws-1");

    expect(provider).toBeDefined();
    expect(provider.createTask).toBeTypeOf("function");
    expect(provider.getTask).toBeTypeOf("function");
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

    const provider = await resolvePlanningProvider(db, project, "ws-1");

    expect(provider).toBeDefined();
    expect(provider.createTask).toBeTypeOf("function");
    expect(db.select).toHaveBeenCalled();
  });

  it("throws PlanningProviderError when linear config is missing (no integration row)", async () => {
    const db = createMockDb([]);
    const project = { planningProvider: "linear", linearProjectId: "proj-1" };

    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toMatchObject({
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

    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toMatchObject({
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

    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toMatchObject({
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

    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toMatchObject({
      code: "PROJECT_NOT_MAPPED",
      retriable: false,
    });
  });

  it("throws PlanningProviderError for unknown provider type", async () => {
    const db = createMockDb();
    const project = { planningProvider: "jira", linearProjectId: null };

    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toThrow(
      PlanningProviderError,
    );
    await expect(resolvePlanningProvider(db, project, "ws-1")).rejects.toMatchObject({
      code: "UNKNOWN_PROVIDER",
      retriable: false,
    });
  });
});
