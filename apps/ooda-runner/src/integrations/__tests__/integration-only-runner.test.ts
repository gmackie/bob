import { afterEach, describe, expect, it, vi } from "vitest";

import type { DomainAdapter } from "@gmacko/ooda/contracts/v1";

import {
  IntegrationOnlyRunner,
  type IntegrationOnlyRunnerApi,
} from "../integration-only-runner";

function createApi(): IntegrationOnlyRunnerApi {
  return {
    register: vi.fn().mockResolvedValue([{ id: "runner-local" }]),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(null),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    claimStatus: vi.fn().mockResolvedValue(null),
    completeStatus: vi.fn().mockResolvedValue(undefined),
    failStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function createAdapter(): DomainAdapter {
  return {
    inspect: vi.fn(),
    validateProposal: vi.fn(),
    commit: vi.fn(),
    lookupByIdempotencyKey: vi.fn(),
    readStatus: vi.fn(),
  } as unknown as DomainAdapter;
}

describe("IntegrationOnlyRunner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses to start when no integration adapter is configured", async () => {
    const api = createApi();
    const runner = new IntegrationOnlyRunner({
      runnerName: "ooda-integrations-local",
      hostname: "mac.local",
      adapters: new Map(),
      api,
    });

    await expect(runner.start()).rejects.toThrow(
      "at least one delivery adapter",
    );
    expect(api.register).not.toHaveBeenCalled();
  });

  it("registers only integration capabilities and polls delivery and status", async () => {
    vi.useFakeTimers();
    const api = createApi();
    const adapters = new Map<string, DomainAdapter>([
      ["obsidian", createAdapter()],
    ]);
    const runner = new IntegrationOnlyRunner({
      runnerName: "ooda-integrations-local",
      hostname: "mac.local",
      adapters,
      api,
      pollIntervalMs: 2_000,
      heartbeatIntervalMs: 30_000,
    });

    await runner.start();

    expect(api.register).toHaveBeenCalledWith({
      name: "ooda-integrations-local",
      hostname: "mac.local",
      capabilities: ["integration:obsidian"],
    });
    expect(api.claim).toHaveBeenCalledWith({
      runnerId: "runner-local",
      destinations: ["obsidian"],
      leaseSeconds: 90,
    });
    expect(api.claimStatus).toHaveBeenCalledWith({
      runnerId: "runner-local",
      destinations: ["obsidian"],
      leaseSeconds: 90,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.heartbeat).toHaveBeenCalledWith({ runnerId: "runner-local" });

    await runner.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("survives a transient polling failure and tries again", async () => {
    vi.useFakeTimers();
    const api = createApi();
    vi.mocked(api.claim)
      .mockRejectedValueOnce(new Error("edge unavailable"))
      .mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runner = new IntegrationOnlyRunner({
      runnerName: "ooda-integrations-local",
      hostname: "mac.local",
      adapters: new Map([["obsidian", createAdapter()]]),
      api,
      pollIntervalMs: 2_000,
    });

    await expect(runner.start()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(api.claim).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "[integration-runner] poll failed:",
      "edge unavailable",
    );
    await runner.stop();
    warn.mockRestore();
  });

  it("drains an in-flight delivery poll before stopping", async () => {
    let releaseClaim: ((value: null) => void) | undefined;
    const claim = new Promise<null>((resolve) => {
      releaseClaim = resolve;
    });
    const api = createApi();
    vi.mocked(api.claim).mockReturnValue(claim);
    const runner = new IntegrationOnlyRunner({
      runnerName: "ooda-integrations-local",
      hostname: "mac.local",
      adapters: new Map([["obsidian", createAdapter()]]),
      api,
    });

    const starting = runner.start();
    await Promise.resolve();
    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseClaim?.(null);
    await starting;
    await stopping;
    expect(stopped).toBe(true);
  });
});
