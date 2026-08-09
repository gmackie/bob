import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  conversationBranches,
  conversationEvents,
  conversations,
} from "../schema/conversations";
import {
  deadLetters,
  deliveryAttempts,
  externalLinks,
  integrationOutbox,
} from "../schema/integrations";
import { hostTurnExecutions } from "../schema/host";
import { attentionReviews, memoryEdges, memorySeeds } from "../schema/memory";
import {
  agentJobEvents,
  agentJobs,
  approvalDecisions,
  contextItems,
  contextPacks,
  proposals,
} from "../schema/orchestration";
import { ttsGrants } from "../schema/voice";

const config = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table);

describe("OODA personal operating system schema", () => {
  it("keeps every canonical table in the ooda schema", () => {
    const tables = [
      conversations,
      conversationBranches,
      conversationEvents,
      memorySeeds,
      memoryEdges,
      attentionReviews,
      agentJobs,
      agentJobEvents,
      contextPacks,
      contextItems,
      proposals,
      approvalDecisions,
      externalLinks,
      integrationOutbox,
      deliveryAttempts,
      deadLetters,
      ttsGrants,
      hostTurnExecutions,
    ];

    expect(tables.map((table) => config(table).schema)).toEqual(
      tables.map(() => "ooda"),
    );
  });

  it("stores only hashed, expiring, one-use TTS grants", () => {
    const grants = config(ttsGrants);
    const columns = grants.columns.map((column) => column.name);
    const indexes = grants.indexes.map((index) => index.config.name);

    expect(columns).toContain("tokenHash");
    expect(columns).not.toContain("token");
    expect(columns).not.toContain("text");
    expect(columns).toContain("expiresAt");
    expect(columns).toContain("usedAt");
    expect(indexes).toContain("tts_grants_token_hash_uidx");
    expect(indexes).toContain("tts_grants_owner_idempotency_uidx");
  });

  it("claims one host execution per durable user event", () => {
    const hostTurns = config(hostTurnExecutions);
    const indexes = hostTurns.indexes.map((index) => index.config.name);

    expect(indexes).toContain("host_turn_executions_user_event_uidx");
    expect(indexes).toContain("host_turn_executions_owner_idempotency_uidx");
    expect(
      hostTurns.columns.find((column) => column.name === "leaseExpiresAt"),
    ).toBeDefined();
    expect(
      hostTurns.columns.find((column) => column.name === "assistantEventId"),
    ).toBeDefined();
  });

  it("enforces one monotonic sequence and one idempotency key per conversation", () => {
    const events = config(conversationEvents);
    const names = events.indexes.map((index) => index.config.name);

    expect(names).toContain("conversation_events_conversation_sequence_uidx");
    expect(names).toContain(
      "conversation_events_conversation_idempotency_uidx",
    );
    expect(
      events.columns.find((column) => column.name === "sequence")?.notNull,
    ).toBe(true);
    expect(
      events.columns.find((column) => column.name === "payload")?.getSQLType(),
    ).toBe("jsonb");
  });

  it("preserves source IDs in explicit migration metadata", () => {
    expect(
      config(conversations)
        .columns.find((column) => column.name === "migrationMetadata")
        ?.getSQLType(),
    ).toBe("jsonb");
    expect(
      config(conversationBranches)
        .columns.find((column) => column.name === "migrationMetadata")
        ?.getSQLType(),
    ).toBe("jsonb");
  });

  it("stores memory embeddings as pgvector rather than bytea", () => {
    const seeds = config(memorySeeds);
    const embedding = seeds.columns.find(
      (column) => column.name === "embedding",
    );

    expect(embedding?.getSQLType()).toBe("vector(1536)");
    expect(embedding?.getSQLType()).not.toBe("bytea");
    expect(seeds.indexes.map((index) => index.config.name)).toContain(
      "memory_seeds_embedding_hnsw_idx",
    );
  });

  it("records immutable approval decisions separately from mutable proposal state", () => {
    const proposal = config(proposals);
    const approvals = config(approvalDecisions);

    expect(
      proposal.columns.find((column) => column.name === "version")?.default,
    ).toBe(1);
    expect(
      approvals.columns.find((column) => column.name === "expectedVersion")
        ?.notNull,
    ).toBe(true);
    expect(
      approvals.columns.find((column) => column.name === "scope")?.default,
    ).toBe("single_delivery");
    expect(
      proposal.columns.find((column) => column.name === "idempotencyKey"),
    ).toBeDefined();
    expect(proposal.indexes.map((index) => index.config.name)).toContain(
      "proposals_conversation_idempotency_uidx",
    );
  });

  it("leases agent jobs and allocates replay-safe progress sequences", () => {
    const jobs = config(agentJobs);
    const events = config(agentJobEvents);

    for (const column of [
      "lastSequence",
      "claimedBy",
      "leaseExpiresAt",
      "lastHeartbeatAt",
      "cancellationRequestedAt",
      "cancelIdempotencyKey",
    ]) {
      expect(
        jobs.columns.find((candidate) => candidate.name === column),
      ).toBeDefined();
    }
    expect(
      events.columns.find((column) => column.name === "idempotencyKey"),
    ).toBeDefined();
    expect(events.indexes.map((index) => index.config.name)).toContain(
      "agent_job_events_job_idempotency_uidx",
    );
  });

  it("supports transactional delivery, reconciliation, and dead-letter repair", () => {
    expect(
      config(integrationOutbox).indexes.map((index) => index.config.name),
    ).toContain("integration_outbox_idempotency_uidx");
    expect(config(deliveryAttempts).foreignKeys).toHaveLength(1);
    expect(
      config(deadLetters).columns.find(
        (column) => column.name === "repairedAt",
      ),
    ).toBeDefined();
    expect(
      config(externalLinks).indexes.map((index) => index.config.name),
    ).toContain("external_links_destination_idempotency_uidx");
    expect(
      config(externalLinks).indexes.map((index) => index.config.name),
    ).toContain("external_links_status_check_idx");
    for (const column of [
      "statusObservedAt",
      "statusClaimedAt",
      "statusClaimedBy",
      "nextStatusCheckAt",
    ]) {
      expect(
        config(externalLinks).columns.find(
          (candidate) => candidate.name === column,
        ),
      ).toBeDefined();
    }
  });
});
