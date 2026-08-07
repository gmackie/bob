import { and, asc, eq, gt, or, sql } from "drizzle-orm";

import type {
  ApprovalDecisionResultV1,
  ApprovalDecisionV1,
  CreateProposalInputV1,
  ProposalListInputV1,
  ProposalV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import { conversationEvents, conversations } from "../db/schema/conversations";
import { integrationOutbox } from "../db/schema/integrations";
import { approvalDecisions, proposals } from "../db/schema/orchestration";
import { OodaKernelProblem, idempotencyConflict, notFound } from "./problems";
import {
  decodeCursor,
  encodeCursor,
  isUniqueViolation,
  stableStringify,
} from "./serialization";

type OodaDatabase = typeof database;

const PROPOSAL_BOUNDARIES: Record<
  ProposalV1["kind"],
  { destination: string; risk: ProposalV1["risk"] }
> = {
  obsidian_note: { destination: "obsidian", risk: "private_write" },
  research_job: { destination: "ooda", risk: "private_write" },
  bob_task: { destination: "bob", risk: "durable_work" },
  bob_project: { destination: "bob", risk: "durable_work" },
  bizpulse_venture: { destination: "bizpulse", risk: "durable_work" },
  content_project: { destination: "creator", risk: "external_write" },
  fabrication_project: { destination: "fabforge", risk: "durable_work" },
  hardware_validation: { destination: "veritas", risk: "durable_work" },
  mobile_release: { destination: "preflight", risk: "durable_work" },
};

function mapProposal(row: typeof proposals.$inferSelect): ProposalV1 {
  return {
    id: row.id,
    conversationId: row.conversationId,
    kind: row.kind as ProposalV1["kind"],
    destination: row.destination,
    status: row.status as ProposalV1["status"],
    risk: row.risk as ProposalV1["risk"],
    preview: row.preview,
    rationale: row.rationale,
    confidence: row.confidence,
    policySnapshot: row.policySnapshot,
    version: row.version,
    ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function validateProposalBoundary(input: CreateProposalInputV1): void {
  const expected = PROPOSAL_BOUNDARIES[input.kind];
  if (
    input.destination !== expected.destination ||
    input.risk !== expected.risk
  ) {
    throw new OodaKernelProblem(
      "VALIDATION_FAILED",
      422,
      `${input.kind} proposals must use ${expected.destination} with ${expected.risk} risk`,
    );
  }
  if (input.kind === "bob_task" || input.kind === "bob_project") {
    const title =
      input.kind === "bob_task" ? input.preview.title : input.preview.name;
    const criteria = input.preview.acceptanceCriteria;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      !Array.isArray(criteria) ||
      criteria.length === 0 ||
      criteria.some(
        (criterion) => typeof criterion !== "string" || !criterion.trim(),
      )
    ) {
      throw new OodaKernelProblem(
        "VALIDATION_FAILED",
        422,
        "Bob proposals require a title or name and non-empty acceptanceCriteria",
      );
    }
  }
}

async function findCreateReplay(
  db: OodaDatabase,
  ownerId: string,
  input: CreateProposalInputV1,
): Promise<{ proposal: ProposalV1; replayed: true } | null> {
  const [row] = await db
    .select({ proposal: proposals })
    .from(proposals)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, proposals.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .where(
      and(
        eq(proposals.conversationId, input.conversationId),
        eq(proposals.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.proposal.commandFingerprint !== stableStringify(input)) {
    throw idempotencyConflict();
  }
  return { proposal: mapProposal(row.proposal), replayed: true };
}

export async function createProposal(
  db: OodaDatabase,
  ownerId: string,
  input: CreateProposalInputV1,
): Promise<{ proposal: ProposalV1; replayed: boolean }> {
  validateProposalBoundary(input);
  const replay = await findCreateReplay(db, ownerId, input);
  if (replay) return replay;
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({
          id: conversations.id,
          activeBranchId: conversations.activeBranchId,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.ownerId, ownerId),
          ),
        )
        .for("update")
        .limit(1);
      if (!conversation?.activeBranchId) throw notFound("Conversation");

      const [proposal] = await tx
        .insert(proposals)
        .values({
          conversationId: input.conversationId,
          kind: input.kind,
          destination: input.destination,
          status: "awaiting_approval",
          risk: input.risk,
          preview: input.preview,
          rationale: input.rationale,
          confidence: input.confidence,
          policySnapshot: {
            ...input.policySnapshot,
            enforcedBoundary: {
              version: "proposal-boundary-v1",
              destination: input.destination,
              risk: input.risk,
              approvalScope: "single_delivery",
            },
          },
          idempotencyKey: input.idempotencyKey,
          commandFingerprint: stableStringify(input),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!proposal) throw new Error("Proposal insert returned no row");
      const [allocated] = await tx
        .update(conversations)
        .set({
          lastSequence: sql`${conversations.lastSequence} + 1`,
          updatedAt: now,
        })
        .where(eq(conversations.id, conversation.id))
        .returning({ sequence: conversations.lastSequence });
      await tx.insert(conversationEvents).values({
        conversationId: conversation.id,
        branchId: conversation.activeBranchId,
        sequence: BigInt(allocated!.sequence),
        type: "proposal",
        actorType: "system",
        actorId: "ooda",
        payload: {
          proposalId: proposal.id,
          kind: proposal.kind,
          status: proposal.status,
          preview: proposal.preview,
        },
        sensitivity: "general",
        correlationId: proposal.id,
        idempotencyKey: `proposal:${input.idempotencyKey}`,
        occurredAt: now,
      });
      return { proposal: mapProposal(proposal), replayed: false };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const concurrentReplay = await findCreateReplay(db, ownerId, input);
    if (concurrentReplay) return concurrentReplay;
    throw error;
  }
}

export async function getProposal(
  db: OodaDatabase,
  ownerId: string,
  proposalId: string,
): Promise<ProposalV1> {
  const [row] = await db
    .select({ proposal: proposals })
    .from(proposals)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, proposals.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!row) throw notFound("Proposal");
  return mapProposal(row.proposal);
}

export async function listProposals(
  db: OodaDatabase,
  ownerId: string,
  input: ProposalListInputV1,
): Promise<{
  items: ProposalV1[];
  pageInfo: { hasMore: boolean; nextCursor?: string };
}> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .limit(1);
  if (!conversation) throw notFound("Conversation");
  const conditions = [eq(proposals.conversationId, input.conversationId)];
  if (input.status) conditions.push(eq(proposals.status, input.status));
  if (input.cursor) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(
      input.cursor,
    );
    const date = new Date(cursor.createdAt);
    if (Number.isNaN(date.getTime()) || typeof cursor.id !== "string") {
      throw new OodaKernelProblem(
        "BAD_CURSOR",
        400,
        "The proposal cursor is invalid",
      );
    }
    conditions.push(
      or(
        gt(proposals.createdAt, date),
        and(eq(proposals.createdAt, date), gt(proposals.id, cursor.id)),
      )!,
    );
  }
  const limit = input.limit ?? 50;
  const rows = await db
    .select()
    .from(proposals)
    .where(and(...conditions))
    .orderBy(asc(proposals.createdAt), asc(proposals.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  return {
    items: visible.map(mapProposal),
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

function sameDecision(
  stored: typeof approvalDecisions.$inferSelect,
  input: ApprovalDecisionV1,
): boolean {
  return (
    stored.decision === input.decision &&
    stored.expectedVersion === input.expectedVersion &&
    stored.scope === input.scope &&
    (stored.rationale ?? undefined) === input.rationale &&
    stored.decidedAt.toISOString() === input.decidedAt
  );
}

export async function decideProposal(
  db: OodaDatabase,
  ownerId: string,
  input: ApprovalDecisionV1,
): Promise<ApprovalDecisionResultV1> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ proposal: proposals, branchId: conversations.activeBranchId })
      .from(proposals)
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, proposals.conversationId),
          eq(conversations.ownerId, ownerId),
        ),
      )
      .where(eq(proposals.id, input.proposalId))
      .for("update")
      .limit(1);
    if (!owned?.branchId) throw notFound("Proposal");

    const [existing] = await tx
      .select()
      .from(approvalDecisions)
      .where(
        and(
          eq(approvalDecisions.proposalId, input.proposalId),
          eq(approvalDecisions.expectedVersion, input.expectedVersion),
        ),
      )
      .limit(1);
    if (existing) {
      if (!sameDecision(existing, input)) throw idempotencyConflict();
      const [outbox] = await tx
        .select({ id: integrationOutbox.id })
        .from(integrationOutbox)
        .where(eq(integrationOutbox.proposalId, input.proposalId))
        .limit(1);
      return {
        proposal: mapProposal(owned.proposal),
        decisionId: existing.id,
        ...(outbox ? { outboxId: outbox.id } : {}),
        replayed: true,
      };
    }
    if (
      owned.proposal.status !== "awaiting_approval" ||
      owned.proposal.version !== input.expectedVersion
    ) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "The proposal changed before this decision was recorded",
      );
    }
    const decidedAt = new Date(input.decidedAt);
    if (owned.proposal.expiresAt && owned.proposal.expiresAt <= decidedAt) {
      throw new OodaKernelProblem("CONFLICT", 409, "The proposal has expired");
    }
    const [decision] = await tx
      .insert(approvalDecisions)
      .values({
        proposalId: input.proposalId,
        decision: input.decision,
        expectedVersion: input.expectedVersion,
        scope: input.scope,
        rationale: input.rationale,
        decidedBy: ownerId,
        decidedAt,
      })
      .returning();
    const [updated] = await tx
      .update(proposals)
      .set({
        status: input.decision === "approve" ? "approved" : "rejected",
        version: sql`${proposals.version} + 1`,
        updatedAt: decidedAt,
      })
      .where(
        and(
          eq(proposals.id, input.proposalId),
          eq(proposals.version, input.expectedVersion),
          eq(proposals.status, "awaiting_approval"),
        ),
      )
      .returning();
    if (!decision || !updated) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "The proposal decision conflicted",
      );
    }

    let outboxId: string | undefined;
    if (input.decision === "approve") {
      const [outbox] = await tx
        .insert(integrationOutbox)
        .values({
          proposalId: updated.id,
          destination: updated.destination,
          idempotencyKey: `proposal:${updated.id}:v${input.expectedVersion}:single_delivery`,
          payload: {
            version: "v1",
            proposal: mapProposal(updated),
            approval: {
              decisionId: decision.id,
              decidedBy: ownerId,
              decidedAt: input.decidedAt,
              scope: "single_delivery",
            },
          },
          availableAt: decidedAt,
          createdAt: decidedAt,
          updatedAt: decidedAt,
        })
        .returning({ id: integrationOutbox.id });
      outboxId = outbox?.id;
    }

    const [allocated] = await tx
      .update(conversations)
      .set({
        lastSequence: sql`${conversations.lastSequence} + 1`,
        updatedAt: decidedAt,
      })
      .where(eq(conversations.id, updated.conversationId))
      .returning({ sequence: conversations.lastSequence });
    await tx.insert(conversationEvents).values({
      conversationId: updated.conversationId,
      branchId: owned.branchId,
      sequence: BigInt(allocated!.sequence),
      type: "approval",
      actorType: "user",
      actorId: ownerId,
      payload: {
        proposalId: updated.id,
        decision: input.decision,
        decisionId: decision.id,
        ...(outboxId ? { outboxId } : {}),
      },
      sensitivity: "general",
      correlationId: updated.id,
      idempotencyKey: `approval:${updated.id}:v${input.expectedVersion}`,
      occurredAt: decidedAt,
    });
    return {
      proposal: mapProposal(updated),
      decisionId: decision.id,
      ...(outboxId ? { outboxId } : {}),
      replayed: false,
    };
  });
}
