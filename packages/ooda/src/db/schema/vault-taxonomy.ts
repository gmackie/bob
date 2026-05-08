import { sql } from "drizzle-orm";
import {
  pgSchema,
  serial,
  text,
  real,
  integer,
  boolean,
  jsonb,
  uuid,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
  customType,
  vector,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

import { graphExploration } from "./research-buddy";

// Custom type for embedding vectors stored as bytea
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const EMBEDDING_DIMS = 1536;

// --- Schema factory: one call per vault ---

function createVaultTaxonomyTables(schema: ReturnType<typeof pgSchema>) {
  const sourceKindEnum = schema.enum("source_kind", [
    "chat",
    "youtube",
    "x-bookmark",
    "chat-import",
    "file",
    "paper-s2",
    "paper-openalex",
  ]);

  const graphEdgeKindEnum = schema.enum("graph_edge_kind", [
    "cites",
    "references",
    "similar_embedding",
    "recommended_by_s2",
  ]);

  const findingsTriageEnum = schema.enum("findings_triage", [
    "pending",
    "saved",
    "dismissed",
    "promoted",
  ]);

  const sources = schema.table(
    "sources",
    {
      id: serial().primaryKey(),
      kind: sourceKindEnum().notNull(),
      externalId: text().notNull(),
      title: text(),
      body: text().notNull(),
      frontmatter: text(), // JSON blob
      url: text(),
      author: text(),
      sourceTs: timestamp({ withTimezone: true }),
      importedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
      contentHash: text().notNull(),
    },
    (t) => [
      uniqueIndex("sources_kind_external_id_idx").on(t.kind, t.externalId),
      index("sources_kind_idx").on(t.kind),
      index("sources_hash_idx").on(t.contentHash),
    ],
  );

  const embeddings = schema.table(
    "embeddings",
    {
      sourceId: integer()
        .notNull()
        .references(() => sources.id, { onDelete: "cascade" }),
      model: text().notNull(),
      dim: integer().notNull(),
      vec: bytea().notNull(),
      createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.sourceId, t.model] })],
  );

  const topics = schema.table("topics", {
    id: serial().primaryKey(),
    label: text(),
    description: text(),
    centroid: bytea(),
    sourceCount: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  });

  const sourceTopics = schema.table(
    "source_topics",
    {
      sourceId: integer()
        .notNull()
        .references(() => sources.id, { onDelete: "cascade" }),
      topicId: integer()
        .notNull()
        .references(() => topics.id, { onDelete: "cascade" }),
      score: real().notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.sourceId, t.topicId] }),
      index("source_topics_topic_idx").on(t.topicId),
    ],
  );

  const kbs = schema.table("kbs", {
    id: serial().primaryKey(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    config: text(), // JSON mirror of kb.yaml compile block
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  });

  const kbSources = schema.table(
    "kb_sources",
    {
      kbId: integer()
        .notNull()
        .references(() => kbs.id, { onDelete: "cascade" }),
      sourceId: integer()
        .notNull()
        .references(() => sources.id, { onDelete: "cascade" }),
      score: real().notNull(),
      reason: text(),
      assignedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.kbId, t.sourceId] }),
      index("kb_sources_kb_idx").on(t.kbId),
    ],
  );

  const importJobs = schema.table("import_jobs", {
    id: serial().primaryKey(),
    kind: text().notNull(),
    config: text(), // JSON: source dir, API creds ref, etc.
    scheduleCron: text(),
    lastRunAt: timestamp({ withTimezone: true }),
    lastCursor: text(),
    lastError: text(),
  });

  // --- Buddy tables (Task 1.2) ---

  // One graph_node per local source that represents an academic paper.
  // PK on source_id because every node corresponds 1:1 with a sources row.
  // Index on first_seen_exploration supports the thread_synergy join
  // `graph_node gn ON gn.first_seen_exploration = ge.id` per refreshed thread.
  const graphNode = schema.table(
    "graph_node",
    {
      sourceId: integer()
        .primaryKey()
        .references(() => sources.id, { onDelete: "cascade" }),
      s2PaperId: text().unique(),
      openalexId: text(),
      doi: text(),
      influenceScore: real(),
      firstSeenExploration: uuid().references(() => graphExploration.id, {
        onDelete: "set null",
      }),
    },
    (t) => [
      index("graph_node_first_seen_idx").on(t.firstSeenExploration),
    ],
  );

  // Directed edge between two paper-sources. Composite PK keeps parallel
  // edges of different kinds distinct (e.g. both "cites" and "similar_embedding").
  // Reverse-lookup index on to_source_id: the dive worker and synergy-tick both
  // need "who points at this paper?" queries.
  const graphEdge = schema.table(
    "graph_edge",
    {
      fromSourceId: integer()
        .notNull()
        .references(() => sources.id, { onDelete: "cascade" }),
      toSourceId: integer()
        .notNull()
        .references(() => sources.id, { onDelete: "cascade" }),
      kind: graphEdgeKindEnum().notNull(),
      weight: real(),
      discoveredIn: uuid().references(() => graphExploration.id, {
        onDelete: "set null",
      }),
    },
    (t) => [
      primaryKey({ columns: [t.fromSourceId, t.toSourceId, t.kind] }),
      index("graph_edge_to_idx").on(t.toSourceId),
      // graphByThread filters edges by `discovered_in IN (exploration ids
      // for thread)` — without this index that subquery scans graph_edge
      // linearly, degrading with vault size.
      index("graph_edge_discovered_in_idx").on(t.discoveredIn),
    ],
  );

  // Recurring interest feed. thread_id is nullable so an interest can be
  // vault-global (not tied to a specific thread). Index on
  // (enabled, last_run_at) powers the scheduler's "what's due?" poll.
  const standingInterest = schema.table(
    "standing_interest",
    {
      id: uuid().primaryKey().defaultRandom(),
      threadId: uuid(),
      label: text().notNull(),
      queryTerms: text()
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      seedSourceIds: integer()
        .array()
        .notNull()
        .default(sql`'{}'::integer[]`),
      cadenceSeconds: integer().notNull().default(7200),
      lastRunAt: timestamp({ withTimezone: true }),
      lastCursor: text(),
      lastError: text(),
      enabled: boolean().notNull().default(true),
      autoDisableSuggested: boolean().notNull().default(false),
    },
    (t) => [
      index("standing_interest_enabled_last_run_idx").on(
        t.enabled,
        t.lastRunAt,
      ),
      // interestList / inboxByThread both filter on
      // `thread_id = :tid OR thread_id IS NULL`. A plain btree on the
      // nullable column lets the equality branch use an index scan.
      index("standing_interest_thread_id_idx").on(t.threadId),
    ],
  );

  // Queue of discovered candidates for human triage.
  // (triage, found_at) index backs the dashboard's "pending, newest first" query.
  const findingsInbox = schema.table(
    "findings_inbox",
    {
      id: uuid().primaryKey().defaultRandom(),
      standingInterestId: uuid().references(() => standingInterest.id, {
        onDelete: "cascade",
      }),
      sourceId: integer()
        .notNull()
        .references(() => sources.id, { onDelete: "cascade" }),
      reasonMd: text(),
      score: real(),
      foundAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
      triage: findingsTriageEnum().notNull().default("pending"),
      triageAt: timestamp({ withTimezone: true }),
    },
    (t) => [
      index("findings_inbox_triage_found_idx").on(
        t.triage,
        t.foundAt.desc(),
      ),
      // schedulers/standing_interests._process_interest issues a
      // per-hit dedup probe: WHERE standing_interest_id=? AND source_id=?
      // on every OpenAlex match. Composite index matches the probe exactly
      // and also backs the leftJoin in dashboard read procedures.
      index("findings_inbox_interest_source_idx").on(
        t.standingInterestId,
        t.sourceId,
      ),
    ],
  );

  // Keyed cache of Semantic Scholar HTTP responses.
  // expires_at index powers TTL cleanup jobs.
  const s2Cache = schema.table(
    "s2_cache",
    {
      key: text().primaryKey(),
      responseJson: jsonb().notNull(),
      fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp({ withTimezone: true }).notNull(),
    },
    (t) => [index("s2_cache_expires_at_idx").on(t.expiresAt)],
  );

  // --- Oracle retrieval layer ---

  const retrievalUnit = schema.table(
    "retrieval_unit",
    {
      id: uuid().primaryKey().defaultRandom(),
      sourceId: integer()
        .notNull()
        .references(() => sources.id, { onDelete: "cascade" }),
      chunkIndex: integer().notNull(),
      content: text().notNull(),
      tokenCount: integer().notNull(),
      startOffset: integer(),
      endOffset: integer(),
      headingContext: text(),
      confidence: real().notNull().default(1.0),
      sourceQuality: real().notNull().default(1.0),
      createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
      contentAsOf: timestamp({ withTimezone: true }),
    },
    (t) => [
      uniqueIndex("retrieval_unit_source_chunk_idx").on(
        t.sourceId,
        t.chunkIndex,
      ),
      index("retrieval_unit_source_id_idx").on(t.sourceId),
    ],
  );

  const retrievalUnitEmbedding = schema.table(
    "retrieval_unit_embedding",
    {
      unitId: uuid()
        .notNull()
        .references(() => retrievalUnit.id, { onDelete: "cascade" }),
      model: text().notNull(),
      embedding: vector({ dimensions: EMBEDDING_DIMS }).notNull(),
      createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.unitId, t.model] }),
      index("retrieval_unit_embedding_vec_idx")
        .using("hnsw", t.embedding.op("vector_cosine_ops")),
    ],
  );

  return {
    sources,
    embeddings,
    topics,
    sourceTopics,
    kbs,
    kbSources,
    importJobs,
    graphNode,
    graphEdge,
    standingInterest,
    findingsInbox,
    s2Cache,
    retrievalUnit,
    retrievalUnitEmbedding,
    graphEdgeKindEnum,
    findingsTriageEnum,
  };
}

// --- Personal vault schema ---

export const personalVaultSchema = pgSchema("personal_vault");
const personalTables = createVaultTaxonomyTables(personalVaultSchema);

export const personalVaultSources = personalTables.sources;
export const personalVaultEmbeddings = personalTables.embeddings;
export const personalVaultTopics = personalTables.topics;
export const personalVaultSourceTopics = personalTables.sourceTopics;
export const personalVaultKbs = personalTables.kbs;
export const personalVaultKbSources = personalTables.kbSources;
export const personalVaultImportJobs = personalTables.importJobs;
export const personalVaultGraphNodes = personalTables.graphNode;
export const personalVaultGraphEdges = personalTables.graphEdge;
export const personalVaultStandingInterests = personalTables.standingInterest;
export const personalVaultFindingsInbox = personalTables.findingsInbox;
export const personalVaultS2Cache = personalTables.s2Cache;
export const personalVaultRetrievalUnits = personalTables.retrievalUnit;
export const personalVaultRetrievalUnitEmbeddings =
  personalTables.retrievalUnitEmbedding;
export const personalVaultGraphEdgeKindEnum = personalTables.graphEdgeKindEnum;
export const personalVaultFindingsTriageEnum =
  personalTables.findingsTriageEnum;

// --- Research vault schema ---

export const researchVaultSchema = pgSchema("research_vault");
const researchTables = createVaultTaxonomyTables(researchVaultSchema);

export const researchVaultSources = researchTables.sources;
export const researchVaultEmbeddings = researchTables.embeddings;
export const researchVaultTopics = researchTables.topics;
export const researchVaultSourceTopics = researchTables.sourceTopics;
export const researchVaultKbs = researchTables.kbs;
export const researchVaultKbSources = researchTables.kbSources;
export const researchVaultImportJobs = researchTables.importJobs;
export const researchVaultGraphNodes = researchTables.graphNode;
export const researchVaultGraphEdges = researchTables.graphEdge;
export const researchVaultStandingInterests = researchTables.standingInterest;
export const researchVaultFindingsInbox = researchTables.findingsInbox;
export const researchVaultS2Cache = researchTables.s2Cache;
export const researchVaultRetrievalUnits = researchTables.retrievalUnit;
export const researchVaultRetrievalUnitEmbeddings =
  researchTables.retrievalUnitEmbedding;
export const researchVaultGraphEdgeKindEnum = researchTables.graphEdgeKindEnum;
export const researchVaultFindingsTriageEnum =
  researchTables.findingsTriageEnum;

// --- Insert schemas for tRPC write targets ---

// Note: we pick one vault's table to derive the zod schema from — the shape
// is identical across vaults so the schema is reusable for either.
export const CreateStandingInterestSchema = createInsertSchema(
  researchTables.standingInterest,
).omit({
  id: true,
  lastRunAt: true,
  lastCursor: true,
  lastError: true,
  autoDisableSuggested: true,
});

export const CreateFindingsInboxSchema = createInsertSchema(
  researchTables.findingsInbox,
).omit({
  id: true,
  foundAt: true,
  triageAt: true,
});

export const CreateGraphNodeSchema = createInsertSchema(researchVaultGraphNodes);

export const CreateGraphEdgeSchema = createInsertSchema(researchVaultGraphEdges);
