import type {
  ClaimExternalStatusInputV1,
  ClaimExternalStatusResultV1,
  CompleteExternalStatusInputV1,
  DomainAdapter,
  FailExternalStatusInputV1,
} from "@gmacko/ooda/contracts/v1";

export type ExternalStatusWorkerApi = {
  claimStatus(
    input: ClaimExternalStatusInputV1,
  ): Promise<ClaimExternalStatusResultV1>;
  completeStatus(input: CompleteExternalStatusInputV1): Promise<unknown>;
  failStatus(input: FailExternalStatusInputV1): Promise<unknown>;
};

export class ExternalStatusWorker {
  private polling = false;
  private stopping = false;

  constructor(
    private readonly config: {
      runnerId: string;
      adapters: Map<string, DomainAdapter>;
      api: ExternalStatusWorkerApi;
    },
  ) {}

  async poll(): Promise<void> {
    if (this.stopping || this.polling || this.config.adapters.size === 0)
      return;
    this.polling = true;
    try {
      const claim = await this.config.api.claimStatus({
        runnerId: this.config.runnerId,
        destinations: [...this.config.adapters.keys()].sort(),
        leaseSeconds: 90,
      });
      if (!claim) return;
      const adapter = this.config.adapters.get(claim.link.destination);
      if (!adapter) {
        await this.config.api.failStatus({
          externalLinkId: claim.link.id,
          runnerId: this.config.runnerId,
          error: `No adapter is configured for ${claim.link.destination}`,
          retrySeconds: 3_600,
        });
        return;
      }
      try {
        const status = await adapter.readStatus(claim.link);
        await this.config.api.completeStatus({
          externalLinkId: claim.link.id,
          runnerId: this.config.runnerId,
          status,
        });
      } catch (error) {
        await this.config.api.failStatus({
          externalLinkId: claim.link.id,
          runnerId: this.config.runnerId,
          error: error instanceof Error ? error.message : String(error),
          retrySeconds: 60,
        });
      }
    } finally {
      this.polling = false;
    }
  }

  stop(): void {
    this.stopping = true;
  }
}
