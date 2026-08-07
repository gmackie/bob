import { and, asc, count, eq, gt, inArray, or, sql } from "drizzle-orm";

import type {
  AgentJobClassV1,
  AgentJobListInputV1,
  AgentJobListPageV1,
  AgentJobV1,
  CancelAgentJobInputV1,
  ClaimAgentJobInputV1,
  ClaimAgentJobResultV1,
  CreateAgentJobInputV1,
  CreateAgentJobResultV1,
  RecordAgentJobEventInputV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import { conversations } from "../db/schema/conversations";
import { agentJobEvents, agentJobs } from "../db/schema/orchestration";
import { OodaKernelProblem, idempotencyConflict, notFound } from "./problems";
import {
  decodeCursor,
  encodeCursor,
  isUniqueViolation,
  stableStringify,
} from "./serialization";

type OodaDatabase = typeof database;

export type AgentJobPolicy = {
  provider: string;
  capabilities: string[];
  budget: { deadlineSeconds: number; aggregateTokens: number };
};

const POLICIES: Record<AgentJobClassV1, AgentJobPolicy> = {
  read_only_research: {
    provider: "codex",
    capabilities: ["project_context.read", "web.read", "scratch.write"],
    budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
  },
  scratch_prototype: {
    provider: "codex",
    capabilities: [
      "process.execute",
      "project_context.read",
      "scratch.read",
      "scratch.write",
      "web.read",
    ],
    budget: { deadlineSeconds: 1_800, aggregateTokens: 250_000 },
  },
  comparison: {
    provider: "claude",
    capabilities: ["model.invoke", "project_context.read"],
    budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
  },
  synthesis: {
    provider: "claude",
    capabilities: ["project_context.read", "web.read"],
    budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
  },
  opportunity_review: {
    provider: "claude",
    capabilities: ["project_context.read", "web.read"],
    budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
  },
};

export function resolveAgentJobPolicy(
  jobClass: AgentJobClassV1,
): AgentJobPolicy {
  const policy = POLICIES[jobClass];
  return {
    provider: policy.provider,
    capabilities: [...policy.capabilities],
    budget: { ...policy.budget },
  };
}

export function validateAgentJobCapabilities(
  jobClass: AgentJobClassV1,
  requested?: string[],
): string[] {
  const allowed = resolveAgentJobPolicy(jobClass).capabilities;
  if (!requested) return allowed;
  const disallowed = requested.filter(
    (capability) => !allowed.includes(capability),
  );
  if (disallowed.length) {
    throw new OodaKernelProblem(
      "VALIDATION_FAILED",
      422,
      `Capabilities not permitted for ${jobClass}: ${disallowed.join(", ")}`,
    );
  }
  return [...new Set(requested)].sort();
}

const ACTIVE_STATUSES = ["queued", "running"];
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
const SUPPORTED_PROVIDERS = new Set(["codex", "claude", "grok", "openai"]);

function mapAgentJob(row: typeof agentJobs.$inferSelect): AgentJobV1 {
  return {
    id: row.id,
    conversationId: row.conversationId,
    class: row.class as AgentJobV1["class"],
    status: row.status as AgentJobV1["status"],
    provider: row.provider,
    capabilities: row.capabilities,
    budget: {
      deadlineSeconds: row.deadlineSeconds,
      aggregateTokens: row.aggregateTokenBudget,
    },
    ...(row.contextPackId ? { contextPackId: row.contextPackId } : {}),
    ...(row.correlationId ? { correlationId: row.correlationId } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
    ...(row.cancellationRequestedAt
      ? { cancellationRequestedAt: row.cancellationRequestedAt.toISOString() }
      : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
  };
}

function effectiveJobPolicy(input: CreateAgentJobInputV1): AgentJobPolicy {
  const defaults = resolveAgentJobPolicy(input.class);
  const provider = input.provider ?? defaults.provider;
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new OodaKernelProblem(
      "VALIDATION_FAILED",
      422,
      `Unsupported agent-job provider: ${provider}`,
    );
  }
  const deadlineSeconds =
    input.budget?.deadlineSeconds ?? defaults.budget.deadlineSeconds;
  const aggregateTokens =
    input.budget?.aggregateTokens ?? defaults.budget.aggregateTokens;
  if (
    deadlineSeconds > defaults.budget.deadlineSeconds ||
    aggregateTokens > defaults.budget.aggregateTokens
  ) {
    throw new OodaKernelProblem(
      "VALIDATION_FAILED",
      422,
      `The requested budget exceeds the ${input.class} policy ceiling`,
    );
  }
  return {
    provider,
    capabilities: validateAgentJobCapabilities(input.class, input.capabilities),
    budget: { deadlineSeconds, aggregateTokens },
  };
}

async function assertOwnedConversation(
  db: OodaDatabase,
  ownerId: string,
  conversationId: string,
) {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Conversation");
}

async function findCreateReplay(
  db: OodaDatabase,
  ownerId: string,
  input: CreateAgentJobInputV1,
): Promise<CreateAgentJobResultV1 | null> {
  await assertOwnedConversation(db, ownerId, input.conversationId);
  const [existing] = await db
    .select()
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.conversationId, input.conversationId),
        eq(agentJobs.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing) return null;
  const [createdEvent] = await db
    .select({ payload: agentJobEvents.payload })
    .from(agentJobEvents)
    .where(
      and(
        eq(agentJobEvents.agentJobId, existing.id),
        eq(agentJobEvents.type, "queued"),
      ),
    )
    .limit(1);
  if (createdEvent?.payload.inputFingerprint !== stableStringify(input)) {
    throw idempotencyConflict();
  }
  return { job: mapAgentJob(existing), replayed: true };
}

export async function createAgentJob(
  db: OodaDatabase,
  ownerId: string,
  input: CreateAgentJobInputV1,
): Promise<CreateAgentJobResultV1> {
  const replay = await findCreateReplay(db, ownerId, input);
  if (replay) return replay;
  const policy = effectiveJobPolicy(input);
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.ownerId, ownerId),
          ),
        )
        .for("update")
        .limit(1);
      if (!conversation) throw notFound("Conversation");

      const [active] = await tx
        .select({ value: count() })
        .from(agentJobs)
        .where(
          and(
            eq(agentJobs.conversationId, input.conversationId),
            inArray(agentJobs.status, ACTIVE_STATUSES),
          ),
        );
      if (Number(active?.value ?? 0) >= 3) {
        throw new OodaKernelProblem(
          "CONFLICT",
          409,
          "A conversation may have at most three active agent jobs",
        );
      }

      const [job] = await tx
        .insert(agentJobs)
        .values({
          conversationId: input.conversationId,
          class: input.class,
          provider: policy.provider,
          capabilities: policy.capabilities,
          deadlineSeconds: policy.budget.deadlineSeconds,
          aggregateTokenBudget: policy.budget.aggregateTokens,
          contextPackId: input.contextPackId,
          correlationId: input.correlationId ?? input.idempotencyKey,
          idempotencyKey: input.idempotencyKey,
          lastSequence: 1,
          expiresAt:
            input.class === "scratch_prototype"
              ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000)
              : undefined,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!job) throw new Error("Agent job insert returned no row");
      await tx.insert(agentJobEvents).values({
        agentJobId: job.id,
        sequence: 1n,
        type: "queued",
        payload: {
          prompt: input.prompt,
          inputFingerprint: stableStringify(input),
          policy,
        },
        idempotencyKey: `create:${input.idempotencyKey}`,
        occurredAt: now,
      });
      return { job: mapAgentJob(job), replayed: false };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const concurrentReplay = await findCreateReplay(db, ownerId, input);
    if (concurrentReplay) return concurrentReplay;
    throw error;
  }
}

export async function getAgentJob(
  db: OodaDatabase,
  ownerId: string,
  jobId: string,
): Promise<AgentJobV1> {
  const [row] = await db
    .select({ job: agentJobs })
    .from(agentJobs)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, agentJobs.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .where(eq(agentJobs.id, jobId))
    .limit(1);
  if (!row) throw notFound("Agent job");
  return mapAgentJob(row.job);
}

export async function listAgentJobs(
  db: OodaDatabase,
  ownerId: string,
  input: AgentJobListInputV1,
): Promise<AgentJobListPageV1> {
  await assertOwnedConversation(db, ownerId, input.conversationId);
  const limit = input.limit ?? 50;
  const conditions = [eq(agentJobs.conversationId, input.conversationId)];
  if (input.status) conditions.push(eq(agentJobs.status, input.status));
  if (input.cursor) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(
      input.cursor,
    );
    const date = new Date(cursor.createdAt);
    if (Number.isNaN(date.getTime()) || typeof cursor.id !== "string") {
      throw new OodaKernelProblem(
        "BAD_CURSOR",
        400,
        "The job cursor is invalid",
      );
    }
    conditions.push(
      or(
        gt(agentJobs.createdAt, date),
        and(eq(agentJobs.createdAt, date), gt(agentJobs.id, cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(agentJobs)
    .where(and(...conditions))
    .orderBy(asc(agentJobs.createdAt), asc(agentJobs.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  return {
    items: visible.map(mapAgentJob),
    pageInfo: {
      hasMore,
      ...(hasMore && visible.at(-1)
        ? {
            nextCursor: encodeCursor({
              createdAt: visible.at(-1)!.createdAt.toISOString(),
              id: visible.at(-1)!.id,
            }),
          }
        : {}),
    },
  };
}

export async function cancelAgentJob(
  db: OodaDatabase,
  ownerId: string,
  input: CancelAgentJobInputV1,
): Promise<{ job: AgentJobV1; replayed: boolean }> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ job: agentJobs })
      .from(agentJobs)
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, agentJobs.conversationId),
          eq(conversations.ownerId, ownerId),
        ),
      )
      .where(eq(agentJobs.id, input.jobId))
      .for("update")
      .limit(1);
    if (!owned) throw notFound("Agent job");
    if (owned.job.cancelIdempotencyKey === input.idempotencyKey) {
      return { job: mapAgentJob(owned.job), replayed: true };
    }
    if (
      owned.job.cancelIdempotencyKey ||
      TERMINAL_STATUSES.has(owned.job.status)
    ) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "The agent job can no longer be cancelled",
      );
    }
    const immediate = owned.job.status === "queued";
    const [updated] = await tx
      .update(agentJobs)
      .set({
        status: immediate ? "cancelled" : "running",
        cancellationRequestedAt: now,
        cancelIdempotencyKey: input.idempotencyKey,
        lastSequence: sql`${agentJobs.lastSequence} + 1`,
        ...(immediate ? { completedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(agentJobs.id, input.jobId))
      .returning();
    if (!updated) throw notFound("Agent job");
    await tx.insert(agentJobEvents).values({
      agentJobId: updated.id,
      sequence: BigInt(updated.lastSequence),
      type: immediate ? "cancelled" : "cancellation_requested",
      payload: { requestedBy: ownerId },
      idempotencyKey: `cancel:${input.idempotencyKey}`,
      occurredAt: now,
    });
    return { job: mapAgentJob(updated), replayed: false };
  });
}

export async function claimAgentJob(
  db: OodaDatabase,
  input: ClaimAgentJobInputV1,
  options: { now?: Date } = {},
): Promise<ClaimAgentJobResultV1> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "queued"),
          inArray(agentJobs.provider, input.providers),
          inArray(agentJobs.class, input.classes),
        ),
      )
      .orderBy(asc(agentJobs.createdAt))
      .for("update", { skipLocked: true })
      .limit(1);
    if (!candidate) return null;
    const [queuedEvent] = await tx
      .select({ payload: agentJobEvents.payload })
      .from(agentJobEvents)
      .where(
        and(
          eq(agentJobEvents.agentJobId, candidate.id),
          eq(agentJobEvents.type, "queued"),
        ),
      )
      .limit(1);
    const prompt = queuedEvent?.payload.prompt;
    if (typeof prompt !== "string" || !prompt) {
      throw new Error(`Agent job ${candidate.id} has no queued prompt`);
    }
    const [claimed] = await tx
      .update(agentJobs)
      .set({
        status: "running",
        claimedBy: input.runnerId,
        startedAt: now,
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + input.leaseSeconds * 1_000),
        lastSequence: sql`${agentJobs.lastSequence} + 1`,
        updatedAt: now,
      })
      .where(
        and(eq(agentJobs.id, candidate.id), eq(agentJobs.status, "queued")),
      )
      .returning();
    if (!claimed) return null;
    await tx.insert(agentJobEvents).values({
      agentJobId: claimed.id,
      sequence: BigInt(claimed.lastSequence),
      type: "claimed",
      payload: { runnerId: input.runnerId },
      idempotencyKey: `claim:${input.runnerId}:${claimed.lastSequence}`,
      occurredAt: now,
    });
    return { job: mapAgentJob(claimed), prompt };
  });
}

export async function recordAgentJobEvent(
  db: OodaDatabase,
  input: RecordAgentJobEventInputV1,
): Promise<{ job: AgentJobV1; replayed: boolean }> {
  const fingerprint = stableStringify(input);
  return db.transaction(async (tx) => {
    const [replay] = await tx
      .select({ payload: agentJobEvents.payload })
      .from(agentJobEvents)
      .where(
        and(
          eq(agentJobEvents.agentJobId, input.jobId),
          eq(agentJobEvents.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (replay) {
      if (replay.payload.inputFingerprint !== fingerprint)
        throw idempotencyConflict();
      const [job] = await tx
        .select()
        .from(agentJobs)
        .where(eq(agentJobs.id, input.jobId));
      if (!job) throw notFound("Agent job");
      return { job: mapAgentJob(job), replayed: true };
    }

    const [current] = await tx
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.id, input.jobId))
      .for("update")
      .limit(1);
    if (!current) throw notFound("Agent job");
    if (current.claimedBy !== input.runnerId) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "The runner does not own this agent job",
      );
    }
    if (current.status !== "running") {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "The agent job is not running",
      );
    }
    if (input.type === "cancelled" && !current.cancellationRequestedAt) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "Cancellation was not requested",
      );
    }

    const terminal = ["completed", "failed", "timed_out", "cancelled"].includes(
      input.type,
    );
    const result =
      input.type === "completed" && typeof input.payload.result === "object"
        ? (input.payload.result as Record<string, unknown>)
        : undefined;
    const error =
      (input.type === "failed" || input.type === "timed_out") &&
      typeof input.payload.error === "string"
        ? input.payload.error.slice(0, 20_000)
        : undefined;
    const tokens =
      typeof input.payload.tokensUsed === "number" &&
      Number.isSafeInteger(input.payload.tokensUsed)
        ? Math.max(
            0,
            Math.min(input.payload.tokensUsed, current.aggregateTokenBudget),
          )
        : current.tokensUsed;
    const occurredAt = new Date(input.occurredAt);
    const [updated] = await tx
      .update(agentJobs)
      .set({
        status: terminal ? input.type : "running",
        lastSequence: sql`${agentJobs.lastSequence} + 1`,
        lastHeartbeatAt: occurredAt,
        tokensUsed: tokens,
        leaseExpiresAt: terminal
          ? null
          : new Date(occurredAt.getTime() + 90 * 1_000),
        ...(terminal
          ? {
              completedAt: occurredAt,
              result,
              error,
            }
          : {}),
        updatedAt: occurredAt,
      })
      .where(eq(agentJobs.id, input.jobId))
      .returning();
    if (!updated) throw notFound("Agent job");
    await tx.insert(agentJobEvents).values({
      agentJobId: updated.id,
      sequence: BigInt(updated.lastSequence),
      type: input.type,
      payload: {
        runnerId: input.runnerId,
        data: input.payload,
        inputFingerprint: fingerprint,
      },
      idempotencyKey: input.idempotencyKey,
      occurredAt,
    });
    return { job: mapAgentJob(updated), replayed: false };
  });
}

export async function inspectAgentJobControl(
  db: OodaDatabase,
  input: { jobId: string; runnerId: string },
): Promise<{
  status: AgentJobV1["status"];
  cancelRequested: boolean;
  leaseExpiresAt?: string;
}> {
  const [job] = await db
    .select({
      status: agentJobs.status,
      claimedBy: agentJobs.claimedBy,
      cancellationRequestedAt: agentJobs.cancellationRequestedAt,
      leaseExpiresAt: agentJobs.leaseExpiresAt,
    })
    .from(agentJobs)
    .where(eq(agentJobs.id, input.jobId))
    .limit(1);
  if (!job) throw notFound("Agent job");
  if (job.claimedBy !== input.runnerId) {
    throw new OodaKernelProblem(
      "CONFLICT",
      409,
      "The runner does not own this agent job",
    );
  }
  return {
    status: job.status as AgentJobV1["status"],
    cancelRequested: Boolean(job.cancellationRequestedAt),
    ...(job.leaseExpiresAt
      ? { leaseExpiresAt: job.leaseExpiresAt.toISOString() }
      : {}),
  };
}
