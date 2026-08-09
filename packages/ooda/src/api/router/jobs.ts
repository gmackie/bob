import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

import {
  AgentJobControlV1Schema,
  AgentJobListInputV1Schema,
  AgentJobListPageV1Schema,
  AgentJobMutationResultV1Schema,
  AgentJobV1Schema,
  CancelAgentJobInputV1Schema,
  ClaimAgentJobInputV1Schema,
  ClaimAgentJobResultV1Schema,
  CreateAgentJobInputV1Schema,
  CreateAgentJobResultV1Schema,
  GetAgentJobControlInputV1Schema,
  GetAgentJobInputV1Schema,
  RecordAgentJobEventInputV1Schema,
} from "../../contracts/v1";
import {
  cancelAgentJob,
  claimAgentJob,
  createConfiguredContextSources,
  createMemoryContextSource,
  createAgentJob,
  getAgentJob,
  inspectAgentJobControl,
  listAgentJobs,
  recordAgentJobEvent,
  resolveContextSourceConfig,
  searchMemories,
} from "../../kernel";
import { authedProcedure, trustedRunnerProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const jobsRouter = {
  list: authedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/jobs",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(AgentJobListInputV1Schema)
    .output(AgentJobListPageV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => listAgentJobs(ctx.db, ctx.userId, input)),
    ),
  get: authedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/jobs/{jobId}",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(GetAgentJobInputV1Schema)
    .output(AgentJobV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => getAgentJob(ctx.db, ctx.userId, input.jobId)),
    ),
  create: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/jobs",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(CreateAgentJobInputV1Schema)
    .output(CreateAgentJobResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() =>
        createAgentJob(ctx.db, ctx.userId, input, {
          contextSources: [
            createMemoryContextSource({
              search: (searchInput) =>
                searchMemories(ctx.db, ctx.userId, searchInput),
              excludeConversationId: input.conversationId,
            }),
            ...createConfiguredContextSources(
              resolveContextSourceConfig(process.env),
            ),
          ],
          signal: AbortSignal.timeout(30_000),
        }),
      ),
    ),
  cancel: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/jobs/{jobId}/cancel",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(CancelAgentJobInputV1Schema)
    .output(AgentJobMutationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => cancelAgentJob(ctx.db, ctx.userId, input)),
    ),
  claim: trustedRunnerProcedure
    .input(ClaimAgentJobInputV1Schema)
    .output(ClaimAgentJobResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => claimAgentJob(ctx.db, input)),
    ),
  recordEvent: trustedRunnerProcedure
    .input(RecordAgentJobEventInputV1Schema)
    .output(AgentJobMutationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => recordAgentJobEvent(ctx.db, input)),
    ),
  control: trustedRunnerProcedure
    .input(GetAgentJobControlInputV1Schema)
    .output(AgentJobControlV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => inspectAgentJobControl(ctx.db, input)),
    ),
} satisfies RouterRecord;
