import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

import {
  ClaimIntegrationDeliveryInputV1Schema,
  ClaimIntegrationDeliveryResultV1Schema,
  ClaimExternalStatusInputV1Schema,
  ClaimExternalStatusResultV1Schema,
  CompleteIntegrationDeliveryInputV1Schema,
  CompleteExternalStatusInputV1Schema,
  DeadLetterListInputV1Schema,
  DeadLetterListPageV1Schema,
  FailIntegrationDeliveryInputV1Schema,
  ExternalStatusMutationResultV1Schema,
  FailExternalStatusInputV1Schema,
  IntegrationDeliveryListInputV1Schema,
  IntegrationDeliveryListPageV1Schema,
  IntegrationDeliveryMutationResultV1Schema,
  ProposalKindV1Schema,
  RepairDeadLetterInputV1Schema,
  RepairDeadLetterResultV1Schema,
} from "../../contracts/v1";
import {
  claimIntegrationDelivery,
  claimExternalStatus,
  completeExternalStatus,
  completeIntegrationDelivery,
  failExternalStatus,
  failIntegrationDelivery,
  listDeadLetters,
  listIntegrationDeliveries,
  repairDeadLetter,
  proposalKindRolloutCapability,
  resolveOodaRolloutPolicy,
} from "../../kernel";
import { rolloutProcedure, trustedRunnerProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

function configuredRolloutOwnerIds(
  env: Record<string, string | undefined> = process.env,
): string[] | undefined {
  const configured = (env.OODA_ROLLOUT_OWNER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length === 0) {
    const probe = resolveOodaRolloutPolicy(
      "__trusted_delivery_rollout_probe__",
      env,
    );
    return probe.eligible ? undefined : [];
  }
  return configured.filter(
    (ownerId) => resolveOodaRolloutPolicy(ownerId, env).eligible,
  );
}

function enabledDeliveryProposalKinds(
  env: Record<string, string | undefined> = process.env,
) {
  const configuredOwners = configuredRolloutOwnerIds(env);
  if (configuredOwners?.length === 0) return [];
  const policy = resolveOodaRolloutPolicy(
    configuredOwners?.[0] ?? "__trusted_delivery_rollout_probe__",
    env,
  );
  return ProposalKindV1Schema.options.filter(
    (kind) => policy.capabilities[proposalKindRolloutCapability(kind)],
  );
}

export const integrationsRouter = {
  listDeliveries: rolloutProcedure("conversation_read")
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/integrations/deliveries",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(IntegrationDeliveryListInputV1Schema)
    .output(IntegrationDeliveryListPageV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => listIntegrationDeliveries(ctx.db, ctx.userId, input)),
    ),
  listDeadLetters: rolloutProcedure("conversation_read")
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/integrations/dead-letters",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(DeadLetterListInputV1Schema)
    .output(DeadLetterListPageV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => listDeadLetters(ctx.db, ctx.userId, input)),
    ),
  repairDeadLetter: rolloutProcedure("durable_work_delivery")
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/integrations/dead-letters/{deadLetterId}/repair",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(RepairDeadLetterInputV1Schema)
    .output(RepairDeadLetterResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => repairDeadLetter(ctx.db, ctx.userId, input)),
    ),
  claim: trustedRunnerProcedure
    .input(ClaimIntegrationDeliveryInputV1Schema)
    .output(ClaimIntegrationDeliveryResultV1Schema)
    .mutation(({ ctx, input }) => {
      const eligibleOwnerIds = configuredRolloutOwnerIds();
      const eligibleProposalKinds = enabledDeliveryProposalKinds();
      if (
        eligibleOwnerIds?.length === 0 ||
        eligibleProposalKinds.length === 0
      ) {
        return null;
      }
      return runKernel(() =>
        claimIntegrationDelivery(ctx.db, input, {
          eligibleOwnerIds,
          eligibleProposalKinds,
          ownerEligible: (ownerId, proposal) => {
            const rollout = resolveOodaRolloutPolicy(ownerId);
            return rollout.capabilities[
              proposalKindRolloutCapability(proposal.kind)
            ];
          },
        }),
      );
    }),
  complete: trustedRunnerProcedure
    .input(CompleteIntegrationDeliveryInputV1Schema)
    .output(IntegrationDeliveryMutationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => completeIntegrationDelivery(ctx.db, input)),
    ),
  fail: trustedRunnerProcedure
    .input(FailIntegrationDeliveryInputV1Schema)
    .output(IntegrationDeliveryMutationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => failIntegrationDelivery(ctx.db, input)),
    ),
  claimStatus: trustedRunnerProcedure
    .input(ClaimExternalStatusInputV1Schema)
    .output(ClaimExternalStatusResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() =>
        claimExternalStatus(ctx.db, input, {
          ownerEligible: (ownerId) =>
            resolveOodaRolloutPolicy(ownerId).capabilities.portfolio_evidence,
        }),
      ),
    ),
  completeStatus: trustedRunnerProcedure
    .input(CompleteExternalStatusInputV1Schema)
    .output(ExternalStatusMutationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => completeExternalStatus(ctx.db, input)),
    ),
  failStatus: trustedRunnerProcedure
    .input(FailExternalStatusInputV1Schema)
    .output(ExternalStatusMutationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => failExternalStatus(ctx.db, input)),
    ),
} satisfies RouterRecord;
