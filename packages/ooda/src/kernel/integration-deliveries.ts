import { and, asc, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  ExternalReceiptV1Schema,
  ObservedExternalStatusV1Schema,
  ProposalV1Schema,
  type ClaimIntegrationDeliveryInputV1,
  type ClaimIntegrationDeliveryResultV1,
  type ClaimExternalStatusInputV1,
  type ClaimExternalStatusResultV1,
  type CompleteIntegrationDeliveryInputV1,
  type CompleteExternalStatusInputV1,
  type DeadLetterV1,
  type FailIntegrationDeliveryInputV1,
  type ExternalStatusMutationResultV1,
  type FailExternalStatusInputV1,
  type IntegrationDeliveryMutationResultV1,
  type IntegrationDeliveryV1,
  type ProposalV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import { conversationEvents, conversations } from "../db/schema/conversations";
import {
  deadLetters,
  deliveryAttempts,
  externalLinks,
  integrationOutbox,
} from "../db/schema/integrations";
import { proposals } from "../db/schema/orchestration";
import { OodaKernelProblem, idempotencyConflict, notFound } from "./problems";
import { decodeCursor, encodeCursor } from "./serialization";

type OodaDatabase = typeof database;
type ProposalKindV1 = ProposalV1["kind"];
const MAX_ATTEMPTS_PER_REPAIR = 5;

function mapDelivery(
  row: typeof integrationOutbox.$inferSelect,
): IntegrationDeliveryV1 {
  return {
    id: row.id,
    proposalId: row.proposalId,
    destination: row.destination,
    idempotencyKey: row.idempotencyKey,
    status: row.status as IntegrationDeliveryV1["status"],
    attemptCount: row.attemptCount,
    availableAt: row.availableAt.toISOString(),
    ...(row.claimedAt ? { claimedAt: row.claimedAt.toISOString() } : {}),
    ...(row.claimedBy ? { claimedBy: row.claimedBy } : {}),
    ...(row.deliveredAt ? { deliveredAt: row.deliveredAt.toISOString() } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapDeadLetter(row: typeof deadLetters.$inferSelect): DeadLetterV1 {
  return {
    id: row.id,
    outboxId: row.outboxId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    ...(row.repairedAt ? { repairedAt: row.repairedAt.toISOString() } : {}),
    ...(row.repairedBy ? { repairedBy: row.repairedBy } : {}),
    ...(row.repairNote ? { repairNote: row.repairNote } : {}),
  };
}

function mapExternalLink(row: typeof externalLinks.$inferSelect) {
  return {
    id: row.id,
    ...(row.proposalId ? { proposalId: row.proposalId } : {}),
    ...(row.conversationId ? { conversationId: row.conversationId } : {}),
    destination: row.destination,
    externalType: row.externalType,
    externalId: row.externalId,
    deepLink: row.deepLink,
    idempotencyKey: row.idempotencyKey,
    status: row.status as "active" | "completed" | "cancelled" | "failed",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function claimExternalStatus(
  db: OodaDatabase,
  input: ClaimExternalStatusInputV1,
  options: {
    now?: Date;
    eligibleOwnerIds?: string[];
    ownerEligible?: (ownerId: string) => boolean;
  } = {},
): Promise<ClaimExternalStatusResultV1> {
  const links = alias(externalLinks, "status_link");
  if (options.eligibleOwnerIds?.length === 0) return null;
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - input.leaseSeconds * 1_000);
  const claimable = and(
    inArray(links.destination, input.destinations),
    eq(links.status, "active"),
    lte(links.nextStatusCheckAt, now),
    or(
      sql`${links.statusClaimedAt} is null`,
      lt(links.statusClaimedAt, staleBefore),
    ),
    options.eligibleOwnerIds
      ? inArray(conversations.ownerId, options.eligibleOwnerIds)
      : undefined,
  );
  let cursor: { due: string; created: string; id: string } | undefined;
  // Scan denied pages without locks; lock/revalidate only an eligible row.
  // UUID is the final tie-breaker so equal timestamps cannot starve the tail.
  while (true) {
    const page = await db
      .select({
        link: links,
        ownerId: conversations.ownerId,
        due: sql<string>`${links.nextStatusCheckAt}::text`,
        created: sql<string>`${links.createdAt}::text`,
      })
      .from(links)
      .innerJoin(conversations, eq(conversations.id, links.conversationId))
      .where(
        and(
          claimable,
          cursor
            ? sql`(${links.nextStatusCheckAt}, ${links.createdAt}, ${links.id}) > (${cursor.due}::timestamptz, ${cursor.created}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(
        asc(links.nextStatusCheckAt),
        asc(links.createdAt),
        asc(links.id),
      )
      .limit(20);
    if (!page.length) return null;
    for (const candidate of page) {
      if (!(options.ownerEligible?.(candidate.ownerId) ?? true)) continue;
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({ link: links, ownerId: conversations.ownerId })
          .from(links)
          .innerJoin(conversations, eq(conversations.id, links.conversationId))
          .where(and(claimable, eq(links.id, candidate.link.id)))
          .for("update", { of: links, skipLocked: true })
          .limit(1);
        if (!current || !(options.ownerEligible?.(current.ownerId) ?? true))
          return null;
        const [claimed] = await tx
          .update(links)
          .set({
            statusClaimedAt: now,
            statusClaimedBy: input.runnerId,
            statusError: null,
            updatedAt: now,
          })
          .where(eq(links.id, current.link.id))
          .returning();
        return { link: mapExternalLink(claimed!) };
      });
      if (result) return result;
    }
    const last = page.at(-1)!;
    cursor = { due: last.due, created: last.created, id: last.link.id };
  }
}

export async function completeExternalStatus(
  db: OodaDatabase,
  input: CompleteExternalStatusInputV1,
  options: { now?: Date; intervalSeconds?: number } = {},
): Promise<ExternalStatusMutationResultV1> {
  const observed = ObservedExternalStatusV1Schema.parse(input.status);
  const now = options.now ?? new Date();
  const nextStatusCheckAt = new Date(
    now.getTime() + (options.intervalSeconds ?? 60) * 1_000,
  );
  return db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(externalLinks)
      .where(eq(externalLinks.id, input.externalLinkId))
      .for("update")
      .limit(1);
    if (!link) throw notFound("External link");
    if (link.statusClaimedBy !== input.runnerId) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "External status is not claimed by this runner",
      );
    }
    const terminalStatus = ["completed", "cancelled", "failed"].includes(
      observed.status,
    )
      ? (observed.status as "completed" | "cancelled" | "failed")
      : link.status;
    const [updated] = await tx
      .update(externalLinks)
      .set({
        status: terminalStatus,
        metadata: {
          ...link.metadata,
          ...observed.metadata,
          externalStatus: observed.status,
        },
        statusObservedAt: new Date(observed.observedAt),
        statusClaimedAt: null,
        statusClaimedBy: null,
        statusError: null,
        nextStatusCheckAt,
        updatedAt: now,
      })
      .where(eq(externalLinks.id, link.id))
      .returning();

    let newEvidenceCount = 0;
    if (link.conversationId && observed.evidence?.length) {
      const [conversation] = await tx
        .select({ branchId: conversations.activeBranchId })
        .from(conversations)
        .where(eq(conversations.id, link.conversationId))
        .for("update")
        .limit(1);
      if (!conversation?.branchId) throw notFound("Conversation");
      for (const evidence of observed.evidence) {
        const idempotencyKey = `external-evidence:${link.id}:${evidence.id}:${evidence.status}`;
        const [existing] = await tx
          .select({ id: conversationEvents.id })
          .from(conversationEvents)
          .where(
            and(
              eq(conversationEvents.conversationId, link.conversationId),
              eq(conversationEvents.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) continue;
        const [allocated] = await tx
          .update(conversations)
          .set({
            lastSequence: sql`${conversations.lastSequence} + 1`,
            updatedAt: now,
          })
          .where(eq(conversations.id, link.conversationId))
          .returning({ sequence: conversations.lastSequence });
        await tx.insert(conversationEvents).values({
          conversationId: link.conversationId,
          branchId: conversation.branchId,
          sequence: BigInt(allocated!.sequence),
          type: "external_evidence",
          actorType: "integration",
          actorId: evidence.source,
          payload: {
            externalLinkId: link.id,
            destination: link.destination,
            evidenceId: evidence.id,
            source: evidence.source,
            kind: evidence.kind,
            externalId: evidence.externalId,
            title: evidence.title,
            status: evidence.status,
            ...(evidence.deepLink ? { url: evidence.deepLink } : {}),
            occurredAt: evidence.occurredAt,
            metadata: evidence.metadata,
          },
          sensitivity: "general",
          correlationId: link.proposalId ?? link.id,
          causationId: link.id,
          idempotencyKey,
          occurredAt: new Date(evidence.occurredAt),
        });
        newEvidenceCount += 1;
      }
    }
    return { link: mapExternalLink(updated!), newEvidenceCount };
  });
}

export async function failExternalStatus(
  db: OodaDatabase,
  input: FailExternalStatusInputV1,
  options: { now?: Date } = {},
): Promise<ExternalStatusMutationResultV1> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(externalLinks)
      .where(eq(externalLinks.id, input.externalLinkId))
      .for("update")
      .limit(1);
    if (!link) throw notFound("External link");
    if (link.statusClaimedBy !== input.runnerId) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "External status is not claimed by this runner",
      );
    }
    const [updated] = await tx
      .update(externalLinks)
      .set({
        statusClaimedAt: null,
        statusClaimedBy: null,
        statusError: input.error,
        nextStatusCheckAt: new Date(now.getTime() + input.retrySeconds * 1_000),
        updatedAt: now,
      })
      .where(eq(externalLinks.id, link.id))
      .returning();
    return { link: mapExternalLink(updated!), newEvidenceCount: 0 };
  });
}

export async function claimIntegrationDelivery(
  db: OodaDatabase,
  input: ClaimIntegrationDeliveryInputV1,
  options: {
    now?: Date;
    eligibleOwnerIds?: string[];
    eligibleProposalKinds?: ProposalKindV1[];
    ownerEligible?: (ownerId: string, proposal: ProposalV1) => boolean;
  } = {},
): Promise<ClaimIntegrationDeliveryResultV1> {
  if (
    options.eligibleOwnerIds?.length === 0 ||
    options.eligibleProposalKinds?.length === 0
  ) {
    return null;
  }
  const outbox = alias(integrationOutbox, "claim_outbox");
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - input.leaseSeconds * 1_000);
  const claimable = and(
    inArray(outbox.destination, input.destinations),
    options.eligibleOwnerIds
      ? inArray(conversations.ownerId, options.eligibleOwnerIds)
      : undefined,
    options.eligibleProposalKinds
      ? inArray(proposals.kind, options.eligibleProposalKinds)
      : undefined,
    lte(outbox.availableAt, now),
    or(
      eq(outbox.status, "pending"),
      and(eq(outbox.status, "delivering"), lt(outbox.claimedAt, staleBefore)),
    ),
  );
  let cursor: { due: string; created: string; id: string } | undefined;
  while (true) {
    const page = await db
      .select({
        delivery: outbox,
        ownerId: conversations.ownerId,
        due: sql<string>`${outbox.availableAt}::text`,
        created: sql<string>`${outbox.createdAt}::text`,
      })
      .from(outbox)
      .innerJoin(proposals, eq(proposals.id, outbox.proposalId))
      .innerJoin(conversations, eq(conversations.id, proposals.conversationId))
      .where(
        and(
          claimable,
          cursor
            ? sql`(${outbox.availableAt}, ${outbox.createdAt}, ${outbox.id}) > (${cursor.due}::timestamptz, ${cursor.created}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(outbox.availableAt), asc(outbox.createdAt), asc(outbox.id))
      .limit(20);
    if (!page.length) return null;
    for (const candidate of page) {
      const proposed = ProposalV1Schema.parse(
        candidate.delivery.payload.proposal,
      );
      if (!(options.ownerEligible?.(candidate.ownerId, proposed) ?? true))
        continue;
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({ delivery: outbox, ownerId: conversations.ownerId })
          .from(outbox)
          .innerJoin(proposals, eq(proposals.id, outbox.proposalId))
          .innerJoin(
            conversations,
            eq(conversations.id, proposals.conversationId),
          )
          .where(and(claimable, eq(outbox.id, candidate.delivery.id)))
          .for("update", { of: outbox, skipLocked: true })
          .limit(1);
        if (!current) return null;
        const proposalValue = ProposalV1Schema.parse(
          current.delivery.payload.proposal,
        );
        if (!(options.ownerEligible?.(current.ownerId, proposalValue) ?? true))
          return null;
        const attempt = current.delivery.attemptCount + 1;
        const [claimed] = await tx
          .update(outbox)
          .set({
            status: "delivering",
            attemptCount: attempt,
            claimedAt: now,
            claimedBy: input.runnerId,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(outbox.id, current.delivery.id))
          .returning();
        await tx
          .insert(deliveryAttempts)
          .values({
            outboxId: current.delivery.id,
            attempt,
            status: "started",
            startedAt: now,
          });
        await tx
          .update(proposals)
          .set({ status: "delivering", updatedAt: now })
          .where(eq(proposals.id, current.delivery.proposalId));
        return { delivery: mapDelivery(claimed!), proposal: proposalValue };
      });
      if (result) return result;
    }
    const last = page.at(-1)!;
    cursor = { due: last.due, created: last.created, id: last.delivery.id };
  }
}

export async function completeIntegrationDelivery(
  db: OodaDatabase,
  input: CompleteIntegrationDeliveryInputV1,
  options: { now?: Date } = {},
): Promise<IntegrationDeliveryMutationResultV1> {
  const receipt = ExternalReceiptV1Schema.parse(input.receipt);
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ delivery: integrationOutbox, proposal: proposals })
      .from(integrationOutbox)
      .innerJoin(proposals, eq(proposals.id, integrationOutbox.proposalId))
      .where(eq(integrationOutbox.id, input.outboxId))
      .for("update")
      .limit(1);
    if (!owned) throw notFound("Integration delivery");
    if (owned.delivery.status === "delivered") {
      const [link] = await tx
        .select()
        .from(externalLinks)
        .where(
          and(
            eq(externalLinks.destination, owned.delivery.destination),
            eq(externalLinks.idempotencyKey, owned.delivery.idempotencyKey),
          ),
        )
        .limit(1);
      if (
        link &&
        (receipt.destination !== link.destination ||
          receipt.idempotencyKey !== link.idempotencyKey ||
          receipt.externalType !== link.externalType ||
          receipt.externalId !== link.externalId ||
          receipt.deepLink !== link.deepLink)
      ) {
        throw idempotencyConflict();
      }
      return {
        delivery: mapDelivery(owned.delivery),
        ...(link ? { externalLink: mapExternalLink(link) } : {}),
      };
    }
    if (
      owned.delivery.status !== "delivering" ||
      owned.delivery.claimedBy !== input.runnerId
    ) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "Delivery is not claimed by this runner",
      );
    }
    if (
      receipt.destination !== owned.delivery.destination ||
      receipt.idempotencyKey !== owned.delivery.idempotencyKey
    ) {
      throw new OodaKernelProblem(
        "VALIDATION_FAILED",
        422,
        "Receipt does not match the claimed delivery",
      );
    }

    await tx
      .update(deliveryAttempts)
      .set({ status: "succeeded", receipt, finishedAt: now })
      .where(
        and(
          eq(deliveryAttempts.outboxId, owned.delivery.id),
          eq(deliveryAttempts.attempt, owned.delivery.attemptCount),
        ),
      );
    const [insertedLink] = await tx
      .insert(externalLinks)
      .values({
        conversationId: owned.proposal.conversationId,
        proposalId: owned.proposal.id,
        destination: receipt.destination,
        externalType: receipt.externalType,
        externalId: receipt.externalId,
        deepLink: receipt.deepLink,
        idempotencyKey: receipt.idempotencyKey,
        status: receipt.status === "completed" ? "completed" : "active",
        metadata: receipt.metadata,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    const [link] = insertedLink
      ? [insertedLink]
      : await tx
          .select()
          .from(externalLinks)
          .where(
            and(
              eq(externalLinks.destination, receipt.destination),
              eq(externalLinks.idempotencyKey, receipt.idempotencyKey),
            ),
          )
          .limit(1);
    const [delivery] = await tx
      .update(integrationOutbox)
      .set({
        status: "delivered",
        deliveredAt: now,
        claimedAt: null,
        claimedBy: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(integrationOutbox.id, owned.delivery.id))
      .returning();
    await tx
      .update(proposals)
      .set({ status: "delivered", updatedAt: now })
      .where(eq(proposals.id, owned.proposal.id));
    const [conversation] = await tx
      .select({ id: conversations.id, branchId: conversations.activeBranchId })
      .from(conversations)
      .where(eq(conversations.id, owned.proposal.conversationId))
      .for("update")
      .limit(1);
    if (!conversation?.branchId) throw notFound("Conversation");
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
      branchId: conversation.branchId,
      sequence: BigInt(allocated!.sequence),
      type: "delivery",
      actorType: "integration",
      actorId: receipt.destination,
      payload: {
        proposalId: owned.proposal.id,
        outboxId: owned.delivery.id,
        receipt,
        externalLinkId: link!.id,
      },
      sensitivity: "general",
      correlationId: owned.proposal.id,
      idempotencyKey: `delivery:${owned.delivery.id}:completed`,
      occurredAt: now,
    });
    return {
      delivery: mapDelivery(delivery!),
      externalLink: mapExternalLink(link!),
    };
  });
}

export async function failIntegrationDelivery(
  db: OodaDatabase,
  input: FailIntegrationDeliveryInputV1,
  options: { now?: Date } = {},
): Promise<IntegrationDeliveryMutationResultV1> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ delivery: integrationOutbox, proposal: proposals })
      .from(integrationOutbox)
      .innerJoin(proposals, eq(proposals.id, integrationOutbox.proposalId))
      .where(eq(integrationOutbox.id, input.outboxId))
      .for("update")
      .limit(1);
    if (!owned) throw notFound("Integration delivery");
    const [recordedAttempt] = await tx
      .select({
        status: deliveryAttempts.status,
        error: deliveryAttempts.error,
      })
      .from(deliveryAttempts)
      .where(
        and(
          eq(deliveryAttempts.outboxId, owned.delivery.id),
          eq(deliveryAttempts.attempt, owned.delivery.attemptCount),
        ),
      )
      .limit(1);
    if (
      (owned.delivery.status === "pending" ||
        owned.delivery.status === "dead_letter") &&
      recordedAttempt?.status === input.classification &&
      recordedAttempt.error === input.error
    ) {
      return { delivery: mapDelivery(owned.delivery) };
    }
    if (
      owned.delivery.status !== "delivering" ||
      owned.delivery.claimedBy !== input.runnerId
    ) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        "Delivery is not claimed by this runner",
      );
    }
    const terminal =
      !input.retryable ||
      owned.delivery.attemptCount % MAX_ATTEMPTS_PER_REPAIR === 0;
    await tx
      .update(deliveryAttempts)
      .set({
        status: input.classification,
        error: input.error,
        finishedAt: now,
      })
      .where(
        and(
          eq(deliveryAttempts.outboxId, owned.delivery.id),
          eq(deliveryAttempts.attempt, owned.delivery.attemptCount),
        ),
      );
    if (terminal) {
      await tx.insert(deadLetters).values({
        outboxId: owned.delivery.id,
        reason: input.error,
        payload: owned.delivery.payload,
        createdAt: now,
      });
    }
    const [delivery] = await tx
      .update(integrationOutbox)
      .set({
        status: terminal ? "dead_letter" : "pending",
        claimedAt: null,
        claimedBy: null,
        lastError: input.error,
        availableAt: terminal
          ? now
          : new Date(
              now.getTime() +
                Math.min(60, 2 ** owned.delivery.attemptCount) * 1_000,
            ),
        updatedAt: now,
      })
      .where(eq(integrationOutbox.id, owned.delivery.id))
      .returning();
    await tx
      .update(proposals)
      .set({ status: terminal ? "failed" : "approved", updatedAt: now })
      .where(eq(proposals.id, owned.proposal.id));
    const [conversation] = await tx
      .select({ id: conversations.id, branchId: conversations.activeBranchId })
      .from(conversations)
      .where(eq(conversations.id, owned.proposal.conversationId))
      .for("update")
      .limit(1);
    if (!conversation?.branchId) throw notFound("Conversation");
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
      branchId: conversation.branchId,
      sequence: BigInt(allocated!.sequence),
      type: "failure",
      actorType: "integration",
      actorId: owned.delivery.destination,
      payload: {
        proposalId: owned.proposal.id,
        outboxId: owned.delivery.id,
        attempt: owned.delivery.attemptCount,
        classification: input.classification,
        error: input.error,
        retryable: input.retryable,
        deadLettered: terminal,
      },
      sensitivity: "general",
      correlationId: owned.proposal.id,
      idempotencyKey: `delivery:${owned.delivery.id}:attempt:${owned.delivery.attemptCount}:failure`,
      occurredAt: now,
    });
    return { delivery: mapDelivery(delivery!) };
  });
}

export async function listIntegrationDeliveries(
  db: OodaDatabase,
  ownerId: string,
  input: {
    conversationId: string;
    status?: string;
    cursor?: string;
    limit?: number;
  },
) {
  const conditions = [
    eq(proposals.conversationId, input.conversationId),
    eq(conversations.ownerId, ownerId),
  ];
  if (input.status) conditions.push(eq(integrationOutbox.status, input.status));
  if (input.cursor) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(
      input.cursor,
    );
    conditions.push(
      or(
        gt(integrationOutbox.createdAt, new Date(cursor.createdAt)),
        and(
          eq(integrationOutbox.createdAt, new Date(cursor.createdAt)),
          gt(integrationOutbox.id, cursor.id),
        ),
      )!,
    );
  }
  const limit = input.limit ?? 50;
  const rows = await db
    .select({ delivery: integrationOutbox })
    .from(integrationOutbox)
    .innerJoin(proposals, eq(proposals.id, integrationOutbox.proposalId))
    .innerJoin(conversations, eq(conversations.id, proposals.conversationId))
    .where(and(...conditions))
    .orderBy(asc(integrationOutbox.createdAt), asc(integrationOutbox.id))
    .limit(limit + 1);
  const visible = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    items: visible.map((row) => mapDelivery(row.delivery)),
    pageInfo: {
      hasMore,
      ...(hasMore && visible.at(-1)
        ? {
            nextCursor: encodeCursor({
              createdAt: visible.at(-1)!.delivery.createdAt.toISOString(),
              id: visible.at(-1)!.delivery.id,
            }),
          }
        : {}),
    },
  };
}

export async function listDeadLetters(
  db: OodaDatabase,
  ownerId: string,
  input: { conversationId: string; cursor?: string; limit?: number },
) {
  const conditions = [
    eq(proposals.conversationId, input.conversationId),
    eq(conversations.ownerId, ownerId),
  ];
  if (input.cursor) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(
      input.cursor,
    );
    conditions.push(
      or(
        gt(deadLetters.createdAt, new Date(cursor.createdAt)),
        and(
          eq(deadLetters.createdAt, new Date(cursor.createdAt)),
          gt(deadLetters.id, cursor.id),
        ),
      )!,
    );
  }
  const limit = input.limit ?? 50;
  const rows = await db
    .select({ deadLetter: deadLetters })
    .from(deadLetters)
    .innerJoin(
      integrationOutbox,
      eq(integrationOutbox.id, deadLetters.outboxId),
    )
    .innerJoin(proposals, eq(proposals.id, integrationOutbox.proposalId))
    .innerJoin(conversations, eq(conversations.id, proposals.conversationId))
    .where(and(...conditions))
    .orderBy(asc(deadLetters.createdAt), asc(deadLetters.id))
    .limit(limit + 1);
  const visible = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    items: visible.map((row) => mapDeadLetter(row.deadLetter)),
    pageInfo: {
      hasMore,
      ...(hasMore && visible.at(-1)
        ? {
            nextCursor: encodeCursor({
              createdAt: visible.at(-1)!.deadLetter.createdAt.toISOString(),
              id: visible.at(-1)!.deadLetter.id,
            }),
          }
        : {}),
    },
  };
}

export async function repairDeadLetter(
  db: OodaDatabase,
  ownerId: string,
  input: {
    deadLetterId: string;
    note: string;
    idempotencyKey: string;
    repairedAt: string;
  },
) {
  const repairedAt = new Date(input.repairedAt);
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({
        deadLetter: deadLetters,
        delivery: integrationOutbox,
        proposal: proposals,
        branchId: conversations.activeBranchId,
      })
      .from(deadLetters)
      .innerJoin(
        integrationOutbox,
        eq(integrationOutbox.id, deadLetters.outboxId),
      )
      .innerJoin(proposals, eq(proposals.id, integrationOutbox.proposalId))
      .innerJoin(
        conversations,
        and(
          eq(conversations.id, proposals.conversationId),
          eq(conversations.ownerId, ownerId),
        ),
      )
      .where(eq(deadLetters.id, input.deadLetterId))
      .for("update")
      .limit(1);
    if (!owned) throw notFound("Dead letter");
    if (owned.deadLetter.repairedAt) {
      if (
        owned.deadLetter.repairIdempotencyKey !== input.idempotencyKey ||
        owned.deadLetter.repairNote !== input.note ||
        owned.deadLetter.repairedAt.toISOString() !== input.repairedAt
      ) {
        throw idempotencyConflict();
      }
      return {
        deadLetter: mapDeadLetter(owned.deadLetter),
        delivery: mapDelivery(owned.delivery),
        replayed: true,
      };
    }
    const [deadLetter] = await tx
      .update(deadLetters)
      .set({
        repairedAt,
        repairedBy: ownerId,
        repairNote: input.note,
        repairIdempotencyKey: input.idempotencyKey,
      })
      .where(eq(deadLetters.id, input.deadLetterId))
      .returning();
    const [delivery] = await tx
      .update(integrationOutbox)
      .set({
        status: "pending",
        availableAt: repairedAt,
        lastError: null,
        claimedAt: null,
        claimedBy: null,
        updatedAt: repairedAt,
      })
      .where(eq(integrationOutbox.id, owned.delivery.id))
      .returning();
    await tx
      .update(proposals)
      .set({ status: "approved", updatedAt: repairedAt })
      .where(eq(proposals.id, owned.proposal.id));
    if (!owned.branchId) throw notFound("Conversation");
    const [allocated] = await tx
      .update(conversations)
      .set({
        lastSequence: sql`${conversations.lastSequence} + 1`,
        updatedAt: repairedAt,
      })
      .where(eq(conversations.id, owned.proposal.conversationId))
      .returning({ sequence: conversations.lastSequence });
    await tx.insert(conversationEvents).values({
      conversationId: owned.proposal.conversationId,
      branchId: owned.branchId,
      sequence: BigInt(allocated!.sequence),
      type: "system_annotation",
      actorType: "user",
      actorId: ownerId,
      payload: {
        proposalId: owned.proposal.id,
        outboxId: owned.delivery.id,
        deadLetterId: owned.deadLetter.id,
        action: "delivery_repaired",
        note: input.note,
      },
      sensitivity: "general",
      correlationId: owned.proposal.id,
      idempotencyKey: `delivery-repair:${input.idempotencyKey}`,
      occurredAt: repairedAt,
    });
    return {
      deadLetter: mapDeadLetter(deadLetter!),
      delivery: mapDelivery(delivery!),
      replayed: false,
    };
  });
}
