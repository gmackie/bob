import type { DomainAdapter } from "@gmacko/ooda/contracts/v1";

import {
  ExternalStatusWorker,
  type ExternalStatusWorkerApi,
} from "./external-status-worker";
import {
  IntegrationDeliveryWorker,
  type IntegrationDeliveryWorkerApi,
} from "./integration-delivery-worker";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

type RegisterInput = {
  name: string;
  hostname: string;
  capabilities: string[];
};

export type IntegrationOnlyRunnerApi = IntegrationDeliveryWorkerApi &
  ExternalStatusWorkerApi & {
    register(input: RegisterInput): Promise<Array<{ id: string }>>;
    heartbeat(input: { runnerId: string }): Promise<unknown>;
  };

export class IntegrationOnlyRunner {
  private deliveryWorker: IntegrationDeliveryWorker | null = null;
  private statusWorker: ExternalStatusWorker | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private runnerId: string | null = null;
  private activePoll: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly config: {
      runnerName: string;
      hostname: string;
      adapters: Map<string, DomainAdapter>;
      api: IntegrationOnlyRunnerApi;
      pollIntervalMs?: number;
      heartbeatIntervalMs?: number;
    },
  ) {}

  async start(): Promise<void> {
    if (this.config.adapters.size === 0) {
      throw new Error(
        "The integration-only runner requires at least one delivery adapter",
      );
    }

    const destinations = [...this.config.adapters.keys()].sort();
    const [device] = await this.config.api.register({
      name: this.config.runnerName,
      hostname: this.config.hostname,
      capabilities: destinations.map(
        (destination) => `integration:${destination}`,
      ),
    });
    if (!device) {
      throw new Error(
        "The integration-only runner could not register a device",
      );
    }
    if (this.stopping) return;

    this.runnerId = device.id;
    this.deliveryWorker = new IntegrationDeliveryWorker({
      runnerId: device.id,
      adapters: this.config.adapters,
      api: this.config.api,
    });
    this.statusWorker = new ExternalStatusWorker({
      runnerId: device.id,
      adapters: this.config.adapters,
      api: this.config.api,
    });

    await this.pollSafely();
    this.pollTimer = setInterval(() => {
      void this.pollSafely();
    }, this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, this.config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.deliveryWorker?.stop();
    this.statusWorker?.stop();
    await this.activePoll;
    this.deliveryWorker = null;
    this.statusWorker = null;
  }

  private async poll(): Promise<void> {
    await Promise.all([this.deliveryWorker?.poll(), this.statusWorker?.poll()]);
  }

  private async pollSafely(): Promise<void> {
    if (this.activePoll) return this.activePoll;
    const active = this.poll().catch((error: unknown) => {
      console.warn(
        "[integration-runner] poll failed:",
        error instanceof Error ? error.message : error,
      );
    });
    this.activePoll = active;
    try {
      await active;
    } finally {
      if (this.activePoll === active) this.activePoll = null;
    }
  }

  private async heartbeat(): Promise<void> {
    if (!this.runnerId) return;
    try {
      await this.config.api.heartbeat({ runnerId: this.runnerId });
    } catch (error) {
      console.warn(
        "[integration-runner] heartbeat failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}
