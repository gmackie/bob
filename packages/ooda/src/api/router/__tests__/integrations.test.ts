import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const DATABASE_URL_PLACEHOLDER =
  "postgres://localhost/ooda-integrations-router-test";
const { setPlaceholder, kernel } = vi.hoisted(() => {
  const setPlaceholder = !process.env.DATABASE_URL;
  process.env.DATABASE_URL ??=
    "postgres://localhost/ooda-integrations-router-test";
  return {
    setPlaceholder,
    kernel: {
      claimIntegrationDelivery: vi.fn(),
      claimExternalStatus: vi.fn(),
      completeExternalStatus: vi.fn(),
      completeIntegrationDelivery: vi.fn(),
      failExternalStatus: vi.fn(),
      failIntegrationDelivery: vi.fn(),
      listDeadLetters: vi.fn(),
      listIntegrationDeliveries: vi.fn(),
      repairDeadLetter: vi.fn(),
      resolveOodaRolloutPolicy: vi.fn(),
      proposalKindRolloutCapability: vi.fn((kind: string) =>
        kind === "research_job" ? "agent_jobs" : "durable_work_delivery",
      ),
    },
  };
});

vi.mock("../../../kernel", () => kernel);

afterAll(() => {
  if (setPlaceholder && process.env.DATABASE_URL === DATABASE_URL_PLACEHOLDER) {
    delete process.env.DATABASE_URL;
  }
});

import { integrationsRouter } from "../integrations";
import { t } from "../../trpc";

const router = t.router({ integrations: integrationsRouter });
const createCaller = t.createCallerFactory(router);
const caller = () =>
  createCaller({
    headers: new Headers({ authorization: "Bearer runner-secret" }),
    db: {} as never,
    auth: undefined,
  });

describe("integrations runner router", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("passes destination-specific owner rollout eligibility to delivery claims", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "runner-secret");
    kernel.claimIntegrationDelivery.mockResolvedValue(null);
    kernel.resolveOodaRolloutPolicy.mockReturnValue({
      eligible: true,
      capabilities: {
        agent_jobs: true,
        durable_work_delivery: false,
      },
    });

    await caller().integrations.claim({
      runnerId: "runner-1",
      destinations: ["bob"],
      leaseSeconds: 90,
    });

    const options = kernel.claimIntegrationDelivery.mock.calls[0]?.[2];
    expect(options.eligibleOwnerIds).toBeUndefined();
    expect(options.eligibleProposalKinds).toEqual(["research_job"]);
    expect(options.ownerEligible("owner-1", { kind: "bob_project" })).toBe(
      false,
    );
    expect(options.ownerEligible("owner-1", { kind: "research_job" })).toBe(
      true,
    );
  });

  it("does not call the delivery kernel while the rollout is killed", async () => {
    vi.stubEnv("OODA_RUNNER_SECRET", "runner-secret");
    kernel.resolveOodaRolloutPolicy.mockReturnValue({
      eligible: false,
      capabilities: {},
    });

    await expect(
      caller().integrations.claim({
        runnerId: "runner-1",
        destinations: ["bob"],
        leaseSeconds: 90,
      }),
    ).resolves.toBeNull();
    expect(kernel.claimIntegrationDelivery).not.toHaveBeenCalled();
  });
});
