import type {
  ClaimIntegrationDeliveryInputV1,
  ClaimIntegrationDeliveryResultV1,
  CompleteIntegrationDeliveryInputV1,
  DomainAdapter,
  FailIntegrationDeliveryInputV1,
} from "@gmacko/ooda/contracts/v1";

export type IntegrationDeliveryWorkerApi = {
  claim(
    input: ClaimIntegrationDeliveryInputV1,
  ): Promise<ClaimIntegrationDeliveryResultV1>;
  complete(input: CompleteIntegrationDeliveryInputV1): Promise<unknown>;
  fail(input: FailIntegrationDeliveryInputV1): Promise<unknown>;
};

export class IntegrationDeliveryWorker {
  private polling = false;
  private stopping = false;

  constructor(
    private readonly config: {
      runnerId: string;
      adapters: Map<string, DomainAdapter>;
      api: IntegrationDeliveryWorkerApi;
    },
  ) {}

  async poll(): Promise<void> {
    if (this.stopping || this.polling || this.config.adapters.size === 0)
      return;
    this.polling = true;
    try {
      const claim = await this.config.api.claim({
        runnerId: this.config.runnerId,
        destinations: [...this.config.adapters.keys()].sort(),
        leaseSeconds: 90,
      });
      if (!claim) return;
      const adapter = this.config.adapters.get(claim.delivery.destination);
      if (!adapter) {
        await this.config.api.fail({
          outboxId: claim.delivery.id,
          runnerId: this.config.runnerId,
          classification: "failed",
          error: `No adapter is configured for ${claim.delivery.destination}`,
          retryable: false,
        });
        return;
      }
      const validation = await adapter.validateProposal(claim.proposal);
      if (!validation.valid) {
        await this.config.api.fail({
          outboxId: claim.delivery.id,
          runnerId: this.config.runnerId,
          classification: "failed",
          error:
            validation.errors.join("; ") || "Destination validation failed",
          retryable: false,
        });
        return;
      }

      try {
        const existing = await adapter.lookupByIdempotencyKey(
          claim.delivery.idempotencyKey,
        );
        const receipt =
          existing ??
          (await adapter.commit(claim.proposal, claim.delivery.idempotencyKey));
        await this.config.api.complete({
          outboxId: claim.delivery.id,
          runnerId: this.config.runnerId,
          receipt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          const reconciled = await adapter.lookupByIdempotencyKey(
            claim.delivery.idempotencyKey,
          );
          if (reconciled) {
            await this.config.api.complete({
              outboxId: claim.delivery.id,
              runnerId: this.config.runnerId,
              receipt: reconciled,
            });
            return;
          }
        } catch (reconcileError) {
          const detail =
            reconcileError instanceof Error
              ? reconcileError.message
              : String(reconcileError);
          await this.config.api.fail({
            outboxId: claim.delivery.id,
            runnerId: this.config.runnerId,
            classification: "ambiguous",
            error: `${message}; reconciliation failed: ${detail}`,
            retryable: true,
          });
          return;
        }
        await this.config.api.fail({
          outboxId: claim.delivery.id,
          runnerId: this.config.runnerId,
          classification: "ambiguous",
          error: message,
          retryable: true,
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
