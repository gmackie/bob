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
  resolveOodaRolloutPolicy,
} from "../../kernel";
import { rolloutProcedure, trustedRunnerProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

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
    .mutation(({ ctx, input }) =>
      runKernel(() => claimIntegrationDelivery(ctx.db, input)),
    ),
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
