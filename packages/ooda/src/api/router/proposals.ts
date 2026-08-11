import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";

import {
  ApprovalDecisionResultV1Schema,
  ApprovalDecisionV1Schema,
  CreateProposalInputV1Schema,
  CreateProposalResultV1Schema,
  GetProposalInputV1Schema,
  ProposalListInputV1Schema,
  ProposalListPageV1Schema,
  ProposalV1Schema,
} from "../../contracts/v1";
import {
  createProposal,
  decideProposal,
  getProposal,
  listProposals,
} from "../../kernel";
import {
  proposalKindRolloutCapability,
  resolveOodaRolloutPolicy,
} from "../../kernel/rollout-policy";
import { authedProcedure, rolloutProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const proposalsRouter = {
  list: rolloutProcedure("conversation_read")
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/proposals",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(ProposalListInputV1Schema)
    .output(ProposalListPageV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => listProposals(ctx.db, ctx.userId, input)),
    ),
  get: rolloutProcedure("conversation_read")
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/proposals/{proposalId}",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(GetProposalInputV1Schema)
    .output(ProposalV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => getProposal(ctx.db, ctx.userId, input.proposalId)),
    ),
  create: rolloutProcedure("conversation_write")
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/proposals",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(CreateProposalInputV1Schema)
    .output(CreateProposalResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => createProposal(ctx.db, ctx.userId, input)),
    ),
  decide: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/proposals/{proposalId}/decisions",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(ApprovalDecisionV1Schema)
    .output(ApprovalDecisionResultV1Schema)
    .mutation(async ({ ctx, input }) => {
      // Rejection remains available during rollback so the user can drain an
      // approval inbox. Only approval can enqueue a destination mutation.
      if (input.decision === "approve") {
        const proposal = await runKernel(() =>
          getProposal(ctx.db, ctx.userId, input.proposalId),
        );
        const rollout = resolveOodaRolloutPolicy(ctx.userId);
        const capability = proposalKindRolloutCapability(proposal.kind);
        if (
          proposal.status === "awaiting_approval" &&
          !rollout.capabilities[capability]
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              `OODA rollout capability ${capability} is not enabled at stage ${rollout.stage}. ${rollout.reasons.join(" ")}`.trim(),
          });
        }
      }
      return runKernel(() => decideProposal(ctx.db, ctx.userId, input));
    }),
} satisfies RouterRecord;
