import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { index, uniqueIndex, vector } from "drizzle-orm/pg-core";

import {
  conversationEvents,
  conversations,
  oodaSchema,
  sensitivityEnum,
} from "./conversations";

export const MEMORY_EMBEDDING_DIMENSIONS = 1536;

export const memorySeedKindEnum = oodaSchema.enum("memory_seed_kind", [
  "question",
  "idea",
  "observation",
  "preference",
  "claim",
  "decision",
  "commitment",
  "correction",
]);

export const memoryLifecycleStateEnum = oodaSchema.enum(
  "memory_lifecycle_state",
  [
    "captured",
    "enriched",
    "incubating",
    "proposed",
    "committed",
    "completed",
    "reflected",
    "dismissed",
    "merged",
    "killed",
  ],
);

export const memoryEdgeKindEnum = oodaSchema.enum("memory_edge_kind", [
  "semantic",
  "entity",
  "temporal",
  "causal",
  "supports",
  "conflicts",
  "supersedes",
  "external",
]);

export const memoryFeedbackStateEnum = oodaSchema.enum(
  "memory_feedback_state",
  ["unreviewed", "confirmed", "suppressed"],
);

export const memorySeeds = oodaSchema.table(
  "memory_seeds",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    conversationId: t
      .uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    kind: memorySeedKindEnum().notNull(),
    sourceEventId: t
      .uuid()
      .notNull()
      .references(() => conversationEvents.id, { onDelete: "cascade" }),
    sourceSpanStart: t.integer().notNull(),
    sourceSpanEnd: t.integer().notNull(),
    normalizedText: t.text().notNull(),
    embedding: vector({ dimensions: MEMORY_EMBEDDING_DIMENSIONS }),
    embeddingModel: t.text(),
    entities: t.text().array().notNull().default([]),
    sensitivity: sensitivityEnum().notNull().default("general"),
    confidence: t.real().notNull(),
    lifecycleState: memoryLifecycleStateEnum().notNull().default("captured"),
    supersededById: t.uuid().references(
      (): AnyPgColumn => memorySeeds.id,
      { onDelete: "set null" },
    ),
    migrationMetadata: t.jsonb().$type<Record<string, unknown>>(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    index("memory_seeds_conversation_created_idx").on(
      t.conversationId,
      t.createdAt,
    ),
    index("memory_seeds_lifecycle_updated_idx").on(
      t.lifecycleState,
      t.updatedAt,
    ),
    index("memory_seeds_embedding_hnsw_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const memoryEdges = oodaSchema.table(
  "memory_edges",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    fromMemoryId: t
      .uuid()
      .notNull()
      .references(() => memorySeeds.id, { onDelete: "cascade" }),
    toMemoryId: t
      .uuid()
      .notNull()
      .references(() => memorySeeds.id, { onDelete: "cascade" }),
    kind: memoryEdgeKindEnum().notNull(),
    score: t.real().notNull(),
    explanation: t.text().notNull(),
    discoveryMethod: t.varchar({ length: 128 }).notNull(),
    feedbackState: memoryFeedbackStateEnum().notNull().default("unreviewed"),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    uniqueIndex("memory_edges_endpoints_kind_uidx").on(
      t.fromMemoryId,
      t.toMemoryId,
      t.kind,
    ),
    index("memory_edges_to_idx").on(t.toMemoryId),
  ],
);

export const attentionReviews = oodaSchema.table(
  "attention_reviews",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    memorySeedId: t
      .uuid()
      .notNull()
      .references(() => memorySeeds.id, { onDelete: "cascade" }),
    dimensionScores: t.jsonb().$type<Record<string, number>>().notNull(),
    uncertainty: t.real().notNull(),
    recommendation: t.varchar({ length: 32 }).notNull(),
    capacitySnapshot: t.jsonb().$type<Record<string, unknown>>().notNull(),
    proposalId: t.uuid(),
    dismissalReason: t.text(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    index("attention_reviews_memory_created_idx").on(
      t.memorySeedId,
      t.createdAt,
    ),
  ],
);
