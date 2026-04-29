import {
  pgTable,
  pgEnum,
  primaryKey,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { researchThread, runnerSession } from "./research";

// Custom type for embedding vectors stored as bytea (mirrors vault-taxonomy.ts pattern).
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const explorationStatusEnum = pgEnum("exploration_status", [
  "queued",
  "running",
  "done",
  "error",
]);

// Note: `cold_thread_update` intentionally omitted — cold-thread updates are
// computed dashboard-side (see design §Dashboard), not persisted as links.
export const threadLinkKindEnum = pgEnum("thread_link_kind", [
  "topic_overlap",
  "citation_overlap",
  "question_answered",
  "supersedes",
  "entity_overlap",
]);

export const entityTypeEnum = pgEnum("entity_type", [
  "person",
  "organization",
  "method",
  "dataset",
  "tool",
  "concept",
  "claim",
]);

export const noteIndex = pgTable(
  "note_index",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    threadId: t
      .uuid()
      .notNull()
      .references(() => researchThread.id, { onDelete: "cascade" }),
    noteId: t.text().notNull(),
    title: t.text().notNull(),
    kind: t.text().notNull(),
    contentHash: t.text().notNull(),
    embedding: bytea(),
    embeddingModel: t.text(),
    extractedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (t) => [
    index("note_index_thread_id_idx").on(t.threadId),
    index("note_index_note_id_idx").on(t.noteId),
  ],
);

export const noteEntity = pgTable(
  "note_entity",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    noteIndexId: t
      .uuid()
      .notNull()
      .references(() => noteIndex.id, { onDelete: "cascade" }),
    threadId: t
      .uuid()
      .notNull()
      .references(() => researchThread.id, { onDelete: "cascade" }),
    name: t.text().notNull(),
    entityType: entityTypeEnum().notNull(),
    salience: t.real().notNull(),
  }),
  (t) => [
    index("note_entity_name_idx").on(t.name),
    index("note_entity_thread_id_idx").on(t.threadId),
    index("note_entity_type_idx").on(t.entityType),
  ],
);

export const graphExploration = pgTable(
  "graph_exploration",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    threadId: t
      .uuid()
      .notNull()
      .references(() => researchThread.id, { onDelete: "cascade" }),
    seed: t.text().array().notNull(),
    budgetPapers: t.integer().notNull().default(60),
    budgetSeconds: t.integer().notNull().default(180),
    status: explorationStatusEnum().notNull().default("queued"),
    startedAt: t.timestamp({ mode: "date", withTimezone: true }),
    finishedAt: t.timestamp({ mode: "date", withTimezone: true }),
    summaryMd: t.text(),
    meta: t.jsonb(),
    errorsJson: t.jsonb(),
    errorMd: t.text(),
  }),
  (t) => [
    index("graph_exploration_status_started_idx").on(t.status, t.startedAt),
    // Every graphByThread call runs
    //   SELECT id FROM graph_exploration WHERE thread_id = :tid
    // as the anchor subquery. Without a thread_id index that subquery
    // scans the full table on every dashboard render.
    index("graph_exploration_thread_id_idx").on(t.threadId),
  ],
);

export const threadMemory = pgTable("thread_memory", (t) => ({
  threadId: t
    .uuid()
    .notNull()
    .primaryKey()
    .references(() => researchThread.id, { onDelete: "cascade" }),
  rollingSummaryMd: t.text(),
  topicFingerprint: t.text().array(),
  embedding: bytea(),
  // Name of the embedding provider/model that produced ``embedding``.
  // NULL when ``embedding`` is NULL (no vector yet). A future "re-embed
  // all placeholder rows" migration can key off this column to find
  // everything that needs a pass, so the synergy tick should NEVER write
  // a value that looks like a real embedding when it isn't — it writes
  // NULL + leaves this column unset. See schedulers/cli.py.
  embeddingModel: t.text(),
  turnsSinceUpdate: t.integer().notNull().default(0),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
}));

export const threadLink = pgTable(
  "thread_link",
  (t) => ({
    fromThreadId: t
      .uuid()
      .notNull()
      .references(() => researchThread.id, { onDelete: "cascade" }),
    // notNull is legitimate now that all remaining kinds have both endpoints.
    toThreadId: t
      .uuid()
      .notNull()
      .references(() => researchThread.id, { onDelete: "cascade" }),
    kind: threadLinkKindEnum().notNull(),
    score: t.real(),
    reasonMd: t.text(),
    discoveredAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.fromThreadId, t.toThreadId, t.kind] }),
    index("thread_link_to_idx").on(t.toThreadId),
  ],
);

export const toolCallLog = pgTable(
  "tool_call_log",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // Tool surface is per-thread — every tool call is thread-scoped.
    threadId: t
      .uuid()
      .notNull()
      .references(() => researchThread.id, { onDelete: "cascade" }),
    runnerSessionId: t
      .uuid()
      .references(() => runnerSession.id, { onDelete: "set null" }),
    toolName: t.text().notNull(),
    args: t.jsonb(),
    resultSummary: t.text(),
    startedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: t.timestamp({ mode: "date", withTimezone: true }),
    error: t.text(),
  }),
  (t) => [
    index("tool_call_log_thread_started_idx").on(t.threadId, t.startedAt),
  ],
);

export const CreateGraphExplorationSchema = createInsertSchema(
  graphExploration,
).omit({
  id: true,
  startedAt: true,
  finishedAt: true,
});

export const CreateToolCallLogSchema = createInsertSchema(toolCallLog).omit({
  id: true,
  startedAt: true,
  finishedAt: true,
});

export const CreateThreadLinkSchema = createInsertSchema(threadLink);
