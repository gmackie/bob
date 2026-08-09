import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notExists,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type {
  ProductionReadinessGateV1,
  ProductionReadinessSnapshotV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import { conversationEvents, conversations } from "../db/schema/conversations";
import {
  deadLetters,
  deliveryAttempts,
  externalLinks,
  integrationOutbox,
} from "../db/schema/integrations";
import {
  approvalDecisions,
  contextItems,
  contextPacks,
  proposals,
} from "../db/schema/orchestration";
import { resolveOodaRolloutPolicy } from "./rollout-policy";

type OodaDatabase = typeof database;
type RolloutEnvironment = Record<string, string | undefined>;

export type ProductionReadinessEvidence = {
  generatedAt: Date;
  dogfoodStartedAt?: Date;
  acceptedTurnCount: number;
  unresolvedTurnCount: number;
  duplicateDestinationCount: number;
  unauthorizedSensitiveDisclosureCount: number;
  externalWriteCount: number;
  externalWriteLineageGapCount: number;
  unrepairedDeadLetterCount: number;
  offlineReconciliationConfirmed: boolean;
  endToEndExecutionConfirmed: boolean;
  mobileDailyDriverConfirmed: boolean;
  legacyRetirementConfirmed: boolean;
};

function gate(
  id: ProductionReadinessGateV1["id"],
  status: ProductionReadinessGateV1["status"],
  observed: string,
  requirement: string,
): ProductionReadinessGateV1 {
  return { id, status, observed, requirement };
}

export function evaluateProductionReadiness(
  evidence: ProductionReadinessEvidence,
): ProductionReadinessSnapshotV1 {
  const elapsedMs = evidence.dogfoodStartedAt
    ? Math.max(
        0,
        evidence.generatedAt.getTime() - evidence.dogfoodStartedAt.getTime(),
      )
    : 0;
  const dogfoodElapsedDays = elapsedMs / (24 * 60 * 60 * 1_000);
  const gates: ProductionReadinessGateV1[] = [
    gate(
      "dogfood_duration",
      !evidence.dogfoodStartedAt || dogfoodElapsedDays < 14
        ? "pending"
        : "pass",
      evidence.dogfoodStartedAt
        ? `${dogfoodElapsedDays.toFixed(2)} days`
        : "not started",
      "At least 14 continuous dogfood days",
    ),
    gate(
      "accepted_turn_durability",
      evidence.unresolvedTurnCount > 0
        ? "fail"
        : evidence.acceptedTurnCount === 0
          ? "pending"
          : "pass",
      `${evidence.acceptedTurnCount} accepted; ${evidence.unresolvedTurnCount} unresolved after grace period`,
      "At least one accepted turn and zero turns without an assistant or failure receipt",
    ),
    gate(
      "duplicate_destinations",
      evidence.duplicateDestinationCount === 0 ? "pass" : "fail",
      `${evidence.duplicateDestinationCount} duplicate destination identities`,
      "Zero duplicate durable destination objects",
    ),
    gate(
      "sensitive_disclosure",
      evidence.unauthorizedSensitiveDisclosureCount === 0 ? "pass" : "fail",
      `${evidence.unauthorizedSensitiveDisclosureCount} sensitive or restricted automatic disclosures`,
      "Zero unauthorized sensitive-context disclosures",
    ),
    gate(
      "external_write_lineage",
      evidence.externalWriteLineageGapCount > 0
        ? "fail"
        : evidence.externalWriteCount === 0
          ? "pending"
          : "pass",
      `${evidence.externalWriteCount} writes; ${evidence.externalWriteLineageGapCount} lineage gaps`,
      "Every external write has proposal, approval, outbox, receipt, and deep link",
    ),
    gate(
      "unrepaired_dead_letters",
      evidence.unrepairedDeadLetterCount === 0 ? "pass" : "fail",
      `${evidence.unrepairedDeadLetterCount} unrepaired dead letters`,
      "Zero unrepaired integration dead letters",
    ),
    gate(
      "offline_reconciliation",
      evidence.offlineReconciliationConfirmed ? "pass" : "pending",
      evidence.offlineReconciliationConfirmed
        ? "witnessed"
        : "no production witness recorded",
      "Offline capture survives restart and reconciles automatically",
    ),
    gate(
      "end_to_end_execution",
      evidence.endToEndExecutionConfirmed ? "pass" : "pending",
      evidence.endToEndExecutionConfirmed
        ? "OODA to KanBanger to Bob to ForgeGraph evidence observed"
        : "complete execution chain not yet observed",
      "At least one project closes the OODA, Bob, KanBanger, and ForgeGraph loop",
    ),
    gate(
      "mobile_daily_driver",
      evidence.mobileDailyDriverConfirmed ? "pass" : "pending",
      evidence.mobileDailyDriverConfirmed
        ? "production witness recorded"
        : "no production witness recorded",
      "Mobile OODA replaces Grok for routine daily conversations",
    ),
    gate(
      "legacy_retirement",
      evidence.legacyRetirementConfirmed ? "pass" : "pending",
      evidence.legacyRetirementConfirmed
        ? "standalone repository retired"
        : "standalone repository remains migration input",
      "Standalone OODA is retired only after data and behavior parity",
    ),
  ];
  return {
    generatedAt: evidence.generatedAt.toISOString(),
    ...(evidence.dogfoodStartedAt
      ? { dogfoodStartedAt: evidence.dogfoodStartedAt.toISOString() }
      : {}),
    dogfoodElapsedDays,
    acceptedTurnCount: evidence.acceptedTurnCount,
    unresolvedTurnCount: evidence.unresolvedTurnCount,
    externalWriteCount: evidence.externalWriteCount,
    gates,
    ready: gates.every(({ status }) => status === "pass"),
  };
}

function confirmedAfterStart(
  value: string | undefined,
  dogfoodStartedAt: Date | undefined,
): boolean {
  if (!value || !dogfoodStartedAt) return false;
  const parsed = new Date(value);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getTime() >= dogfoodStartedAt.getTime()
  );
}

export async function getProductionReadiness(
  db: OodaDatabase,
  ownerId: string,
  options: {
    now?: Date;
    env?: RolloutEnvironment;
    unresolvedGraceSeconds?: number;
  } = {},
): Promise<ProductionReadinessSnapshotV1> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const rollout = resolveOodaRolloutPolicy(ownerId, env);
  const dogfoodStartedAt = rollout.dogfoodStartedAt
    ? new Date(rollout.dogfoodStartedAt)
    : undefined;
  const observationStart = dogfoodStartedAt ?? now;
  const unresolvedBefore = new Date(
    now.getTime() - (options.unresolvedGraceSeconds ?? 300) * 1_000,
  );
  const responses = alias(conversationEvents, "turn_responses");

  const [acceptedRow, unresolvedRow, sensitiveRow, deadLetterRow, linkRows] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(conversationEvents)
        .innerJoin(
          conversations,
          and(
            eq(conversations.id, conversationEvents.conversationId),
            eq(conversations.ownerId, ownerId),
          ),
        )
        .where(
          and(
            eq(conversationEvents.type, "user_turn"),
            gte(conversationEvents.occurredAt, observationStart),
          ),
        ),
      db
        .select({ value: count() })
        .from(conversationEvents)
        .innerJoin(
          conversations,
          and(
            eq(conversations.id, conversationEvents.conversationId),
            eq(conversations.ownerId, ownerId),
          ),
        )
        .where(
          and(
            eq(conversationEvents.type, "user_turn"),
            gte(conversationEvents.occurredAt, observationStart),
            lt(conversationEvents.occurredAt, unresolvedBefore),
            notExists(
              db
                .select({ one: sql<number>`1` })
                .from(responses)
                .where(
                  and(
                    eq(
                      responses.conversationId,
                      conversationEvents.conversationId,
                    ),
                    sql`${responses.causationId} = ${conversationEvents.id}::text`,
                    inArray(responses.type, ["assistant_turn", "failure"]),
                  ),
                ),
            ),
          ),
        ),
      db
        .select({ value: count() })
        .from(contextItems)
        .innerJoin(
          contextPacks,
          eq(contextPacks.id, contextItems.contextPackId),
        )
        .innerJoin(
          conversations,
          and(
            eq(conversations.id, contextPacks.conversationId),
            eq(conversations.ownerId, ownerId),
          ),
        )
        .where(
          and(
            eq(contextItems.decision, "disclosed"),
            inArray(contextItems.sensitivity, ["sensitive", "restricted"]),
            gte(contextPacks.createdAt, observationStart),
          ),
        ),
      db
        .select({ value: count() })
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
        .where(
          and(
            isNull(deadLetters.repairedAt),
            gte(deadLetters.createdAt, observationStart),
          ),
        ),
      db
        .select({ link: externalLinks })
        .from(externalLinks)
        .innerJoin(
          conversations,
          and(
            eq(conversations.id, externalLinks.conversationId),
            eq(conversations.ownerId, ownerId),
          ),
        )
        .where(gte(externalLinks.createdAt, observationStart)),
    ]);

  const links = linkRows.map(({ link }) => link);
  const proposalIds = links.flatMap(({ proposalId }) =>
    proposalId ? [proposalId] : [],
  );
  const evidenceConversationIds = [
    ...new Set(links.map(({ conversationId }) => conversationId)),
  ].filter((value): value is string => Boolean(value));
  const [decisions, outboxes, evidenceRows] = await Promise.all([
    proposalIds.length
      ? db
          .select({ proposalId: approvalDecisions.proposalId })
          .from(approvalDecisions)
          .where(
            and(
              inArray(approvalDecisions.proposalId, proposalIds),
              eq(approvalDecisions.decision, "approve"),
            ),
          )
      : Promise.resolve([]),
    proposalIds.length
      ? db
          .select({ outbox: integrationOutbox })
          .from(integrationOutbox)
          .where(inArray(integrationOutbox.proposalId, proposalIds))
      : Promise.resolve([]),
    evidenceConversationIds.length
      ? db
          .select({
            conversationId: conversationEvents.conversationId,
            payload: conversationEvents.payload,
          })
          .from(conversationEvents)
          .where(
            and(
              eq(conversationEvents.type, "external_evidence"),
              inArray(
                conversationEvents.conversationId,
                evidenceConversationIds,
              ),
              gte(conversationEvents.occurredAt, observationStart),
            ),
          )
      : Promise.resolve([]),
  ]);
  const outboxRows = outboxes.map(({ outbox }) => outbox);
  const outboxIds = outboxRows.map(({ id }) => id);
  const attempts = outboxIds.length
    ? await db
        .select({
          outboxId: deliveryAttempts.outboxId,
          receipt: deliveryAttempts.receipt,
        })
        .from(deliveryAttempts)
        .where(
          and(
            inArray(deliveryAttempts.outboxId, outboxIds),
            eq(deliveryAttempts.status, "succeeded"),
          ),
        )
    : [];
  const approved = new Set(decisions.map(({ proposalId }) => proposalId));
  const successfulAttempts = new Set(
    attempts.flatMap(({ outboxId, receipt }) => (receipt ? [outboxId] : [])),
  );
  const deliveredByProposal = new Map<string, boolean>();
  for (const outbox of outboxRows) {
    if (outbox.status === "delivered" && successfulAttempts.has(outbox.id)) {
      deliveredByProposal.set(outbox.proposalId, true);
    }
  }
  const externalWriteLineageGapCount = links.filter(
    (link) =>
      !link.proposalId ||
      !approved.has(link.proposalId) ||
      !deliveredByProposal.get(link.proposalId) ||
      !link.deepLink,
  ).length;
  const destinationKeys = new Set<string>();
  let duplicateDestinationCount = 0;
  for (const link of links) {
    const key = `${link.destination}\u0000${link.idempotencyKey}`;
    if (destinationKeys.has(key)) duplicateDestinationCount += 1;
    destinationKeys.add(key);
  }
  const sourcesByConversation = new Map<string, Set<string>>();
  for (const row of evidenceRows) {
    const source = row.payload.source;
    if (typeof source !== "string") continue;
    const sources = sourcesByConversation.get(row.conversationId) ?? new Set();
    sources.add(source);
    sourcesByConversation.set(row.conversationId, sources);
  }
  const endToEndExecutionConfirmed = links.some((link) => {
    if (link.destination !== "bob" || link.externalType !== "project")
      return false;
    const sources = link.conversationId
      ? sourcesByConversation.get(link.conversationId)
      : undefined;
    return Boolean(
      sources?.has("bob") &&
      sources.has("kanbanger") &&
      sources.has("forgegraph"),
    );
  });

  return evaluateProductionReadiness({
    generatedAt: now,
    dogfoodStartedAt,
    acceptedTurnCount: acceptedRow[0]?.value ?? 0,
    unresolvedTurnCount: unresolvedRow[0]?.value ?? 0,
    duplicateDestinationCount,
    unauthorizedSensitiveDisclosureCount: sensitiveRow[0]?.value ?? 0,
    externalWriteCount: links.length,
    externalWriteLineageGapCount,
    unrepairedDeadLetterCount: deadLetterRow[0]?.value ?? 0,
    offlineReconciliationConfirmed: confirmedAfterStart(
      env.OODA_OFFLINE_RECONCILIATION_CONFIRMED_AT,
      dogfoodStartedAt,
    ),
    endToEndExecutionConfirmed,
    mobileDailyDriverConfirmed: confirmedAfterStart(
      env.OODA_MOBILE_DAILY_DRIVER_CONFIRMED_AT,
      dogfoodStartedAt,
    ),
    legacyRetirementConfirmed: confirmedAfterStart(
      env.OODA_LEGACY_RETIRED_AT,
      dogfoodStartedAt,
    ),
  });
}
