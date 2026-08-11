import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { TRPCError } from "@trpc/server";

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
import type { ClaimAgentJobInputV1 } from "../../contracts/v1";
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
  resolveAgentJobPolicy,
  resolveContextSourceConfig,
  searchMemories,
} from "../../kernel";
import { resolveOodaRolloutPolicy } from "../../kernel/rollout-policy";
import {
  authedProcedure,
  rolloutProcedure,
  trustedRunnerProcedure,
} from "../trpc";
import { runKernel } from "./_kernel-error";

function configuredValues(
  name: string,
  env: Record<string, string | undefined> = process.env,
): Set<string> | null {
  const raw = env[name];
  if (!raw?.trim()) return env.NODE_ENV === "production" ? new Set() : null;
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

type AgentJobRuntimeAvailability = {
  enabledProviders?: string[];
  enabledClasses?: string[];
};

function agentJobRuntimeAvailability(
  env: Record<string, string | undefined> = process.env,
): AgentJobRuntimeAvailability {
  const providers = configuredValues("OODA_AGENT_JOB_ENABLED_PROVIDERS", env);
  const classes = configuredValues("OODA_AGENT_JOB_ENABLED_CLASSES", env);
  return {
    ...(providers === null ? {} : { enabledProviders: [...providers] }),
    ...(classes === null ? {} : { enabledClasses: [...classes] }),
  };
}

function enabledRunnerClaim(
  input: ClaimAgentJobInputV1,
  availability: AgentJobRuntimeAvailability,
): ClaimAgentJobInputV1 | null {
  const providers = availability.enabledProviders
    ? input.providers.filter((provider) =>
        availability.enabledProviders!.includes(provider),
      )
    : input.providers;
  const classes = availability.enabledClasses
    ? input.classes.filter((jobClass) =>
        availability.enabledClasses!.includes(jobClass),
      )
    : input.classes;
  if (providers.length === 0 || classes.length === 0) return null;
  return { ...input, providers, classes };
}

function assertInitialJobRuntimeEnabled(
  input: { class: string; provider?: string },
  env: Record<string, string | undefined> = process.env,
): void {
  const classes = configuredValues("OODA_AGENT_JOB_ENABLED_CLASSES", env);
  if (classes && !classes.has(input.class)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Agent-job class ${input.class} is not enabled for this rollout`,
    });
  }
  const provider =
    input.provider ??
    resolveAgentJobPolicy(
      input.class as Parameters<typeof resolveAgentJobPolicy>[0],
    ).provider;
  const providers = configuredValues("OODA_AGENT_JOB_ENABLED_PROVIDERS", env);
  if (providers && !providers.has(provider)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Agent-job provider ${provider} is not enabled for this rollout`,
    });
  }
}

function eligibleRunnerOwnerIds(
  env: Record<string, string | undefined> = process.env,
): string[] | undefined {
  const configured = (env.OODA_ROLLOUT_OWNER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length === 0) {
    const developmentPolicy = resolveOodaRolloutPolicy(
      "__trusted_runner_rollout_probe__",
      env,
    );
    return developmentPolicy.capabilities.agent_jobs ? undefined : [];
  }
  return configured.filter(
    (ownerId) => resolveOodaRolloutPolicy(ownerId, env).capabilities.agent_jobs,
  );
}

export const jobsRouter = {
  list: rolloutProcedure("conversation_read")
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
  get: rolloutProcedure("conversation_read")
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
  create: rolloutProcedure("agent_jobs")
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
    .mutation(({ ctx, input }) => {
      assertInitialJobRuntimeEnabled(input);
      return runKernel(() =>
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
      );
    }),
  // Cancellation is a safety control, not a capability expansion. It remains
  // available after rollback or a global kill so owners can drain work.
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
    .mutation(({ ctx, input }) => {
      const eligibleOwnerIds = eligibleRunnerOwnerIds();
      if (eligibleOwnerIds?.length === 0) return null;
      const constrainedInput = enabledRunnerClaim(
        input,
        agentJobRuntimeAvailability(),
      );
      if (!constrainedInput) return null;
      return runKernel(() =>
        claimAgentJob(ctx.db, constrainedInput, { eligibleOwnerIds }),
      );
    }),
  recordEvent: trustedRunnerProcedure
    // Terminal events remain available while the rollout is disabled so a
    // worker responding to control-plane cancellation can drain cleanly.
    .input(RecordAgentJobEventInputV1Schema)
    .output(AgentJobMutationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => recordAgentJobEvent(ctx.db, input)),
    ),
  control: trustedRunnerProcedure
    .input(GetAgentJobControlInputV1Schema)
    .output(AgentJobControlV1Schema)
    .query(({ ctx, input }) => {
      const eligibleOwnerIds = eligibleRunnerOwnerIds();
      const availability = agentJobRuntimeAvailability();
      return runKernel(() =>
        inspectAgentJobControl(ctx.db, input, {
          eligibleOwnerIds,
          ...availability,
        }),
      );
    }),
} satisfies RouterRecord;
