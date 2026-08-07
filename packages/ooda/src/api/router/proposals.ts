import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

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
import { authedProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const proposalsRouter = {
  list: authedProcedure
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
  get: authedProcedure
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
  create: authedProcedure
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
    .mutation(({ ctx, input }) =>
      runKernel(() => decideProposal(ctx.db, ctx.userId, input)),
    ),
} satisfies RouterRecord;
