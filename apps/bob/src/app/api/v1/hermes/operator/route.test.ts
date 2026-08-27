import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBobEveningCloseReader: vi.fn(),
  createBobWorkBriefReader: vi.fn(),
  createBobWorkStatusReader: vi.fn(),
  createForgeGraphBriefReader: vi.fn(),
  createHermesEveningCloseReader: vi.fn(),
  createHermesOperatorRuntime: vi.fn(),
  createHermesUsageStore: vi.fn(),
  createOodaBriefReader: vi.fn(),
  createSkillfleetBriefReader: vi.fn(),
  handleHermesOperatorRequest: vi.fn(),
  validateApiKey: vi.fn(),
  withApiRateLimit: vi.fn(),
  workItemsGet: vi.fn(),
  workItemsList: vi.fn(),
  workItemStatusCounts: vi.fn(),
}));

vi.mock("@bob/auth", () => ({ validateApiKey: mocks.validateApiKey }));
vi.mock("@bob/api/handlers/workItems", () => ({
  workItemsGet: mocks.workItemsGet,
  workItemsList: mocks.workItemsList,
  workItemStatusCounts: mocks.workItemStatusCounts,
}));
vi.mock("@bob/db", () => ({ createHermesUsageStore: mocks.createHermesUsageStore }));
vi.mock("@bob/db/client", () => ({ db: {} }));
vi.mock("~/lib/hermes-briefing-readers", () => ({
  HERMES_ACTIVE_BOB_WORK_STATUSES: ["in_progress"],
  createBobEveningCloseReader: mocks.createBobEveningCloseReader,
  createBobWorkBriefReader: mocks.createBobWorkBriefReader,
  createBobWorkStatusReader: mocks.createBobWorkStatusReader,
  createForgeGraphBriefReader: mocks.createForgeGraphBriefReader,
  createHermesEveningCloseReader: mocks.createHermesEveningCloseReader,
  createOodaBriefReader: mocks.createOodaBriefReader,
  createSkillfleetBriefReader: mocks.createSkillfleetBriefReader,
}));
vi.mock("~/lib/hermes-operator-runtime", () => ({
  createHermesOperatorRuntime: mocks.createHermesOperatorRuntime,
}));
vi.mock("~/lib/hermes-operator-route", () => ({
  HermesOperatorUnavailableError: class extends Error {},
  handleHermesOperatorRequest: mocks.handleHermesOperatorRequest,
}));
vi.mock("~/lib/rest/api-helpers", () => ({
  withApiRateLimit: mocks.withApiRateLimit,
}));

import { POST } from "./route";

describe("Hermes operator route composition", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const [name, value] of Object.entries({
      HERMES_BOB_WORKSPACE_ID: "workspace-1",
      HERMES_OPERATOR_OWNER_USER_ID: "owner-1",
      HERMES_OODA_ORIGIN_URL: "https://ooda.example.com",
      HERMES_OODA_API_KEY: "ooda-key",
      HERMES_OODA_CONVERSATION_ID: "conversation-1",
      HERMES_OODA_BRANCH_ID: "branch-1",
      HERMES_USAGE_DIGEST_SECRET: "digest-secret",
      SKILLFLEET_ORIGIN_URL: "https://skillfleet.example.com",
      SKILLFLEET_HERMES_READ_SECRET: "skillfleet-key",
      SKILLFLEET_ACCESS_CLIENT_ID: "access-id",
      SKILLFLEET_ACCESS_CLIENT_SECRET: "access-secret",
      FORGEGRAPH_API_URL: "https://forgegraph.example.com",
      FORGEGRAPH_API_KEY: "forgegraph-key",
      FORGEGRAPH_CONTEXT_APPS: "ooda,bob",
    })) vi.stubEnv(name, value);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("shares configured Skillfleet and ForgeGraph readers between today and close", async () => {
    const oodaReader = { read: vi.fn(), readClose: vi.fn() };
    const bobCloseReader = { read: vi.fn() };
    const skillfleetReader = { read: vi.fn() };
    const forgeGraphReader = { read: vi.fn() };
    const closeReader = { read: vi.fn() };
    const statusReader = { read: vi.fn() };
    const workReader = { read: vi.fn() };
    const usage = { record: vi.fn() };
    let runtimeDependencies: Record<string, unknown> | undefined;
    let bobCloseDependencies: {
      listChanged(updatedAfter: string): Promise<unknown>;
    } | undefined;

    mocks.createOodaBriefReader.mockReturnValue(oodaReader);
    mocks.createBobEveningCloseReader.mockImplementation((dependencies) => {
      bobCloseDependencies = dependencies as typeof bobCloseDependencies;
      return bobCloseReader;
    });
    mocks.createSkillfleetBriefReader.mockReturnValue(skillfleetReader);
    mocks.createForgeGraphBriefReader.mockReturnValue(forgeGraphReader);
    mocks.createHermesEveningCloseReader.mockReturnValue(closeReader);
    mocks.createBobWorkStatusReader.mockReturnValue(statusReader);
    mocks.createBobWorkBriefReader.mockReturnValue(workReader);
    mocks.createHermesUsageStore.mockReturnValue(usage);
    mocks.createHermesOperatorRuntime.mockImplementation((
      _config: unknown,
      dependencies: Record<string, unknown>,
    ) => {
      runtimeDependencies = dependencies;
      return { createService: vi.fn(() => ({})) };
    });
    mocks.handleHermesOperatorRequest.mockImplementation(async (
      _request: Request,
      options: { createService(auth: { userId: string }): unknown },
    ) => {
      options.createService({ userId: "owner-1" });
      return Response.json({ ok: true });
    });
    mocks.withApiRateLimit.mockImplementation((
      _request: Request,
      handler: () => Promise<Response>,
    ) => handler());

    const response = await POST(new Request(
      "https://bob.example.com/api/v1/hermes/operator",
      { method: "POST" },
    ));

    expect(response.status).toBe(200);
    expect(mocks.createHermesEveningCloseReader).toHaveBeenCalledWith(
      expect.objectContaining({
        bob: bobCloseReader,
        ooda: oodaReader,
        supportingSources: {
          skillfleet: skillfleetReader,
          forgegraph: forgeGraphReader,
        },
      }),
    );
    expect(runtimeDependencies).toMatchObject({
      closeReader,
      briefingSources: {
        ooda: oodaReader,
        bob: workReader,
        skillfleet: skillfleetReader,
        forgegraph: forgeGraphReader,
      },
    });
    await bobCloseDependencies?.listChanged("2026-08-21T00:00:00.000Z");
    expect(mocks.workItemsList).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-1" }),
      expect.objectContaining({
        workspaceId: "workspace-1",
        updatedAfter: "2026-08-21T00:00:00.000Z",
        limit: 101,
      }),
    );
  });
});
